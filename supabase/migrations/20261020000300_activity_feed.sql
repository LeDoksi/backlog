-- Activity events and the friends feed. The trigger writes an event only
-- when the board is open to someone and the title is not hidden; the feed
-- checks both again at read time, so closing a board or hiding a title
-- also takes back what was already shown.
create or replace function public.titles_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := coalesce(auth.uid(), new.created_by);
  vis text;
  k text;
  fresh int;
begin
  if actor is null or new.hidden then return new; end if;
  select visibility into vis from workspaces where id = new.workspace_id;
  -- Nothing is recorded on a private board, so opening it later cannot
  -- surface what happened while it was private.
  if vis = 'private' then return new; end if;
  if tg_op = 'INSERT' then
    -- A row carrying an old created_at is a migrated title, not news.
    if new.created_at < now() - interval '1 minute' then return new; end if;
    insert into activity_events (actor_id, workspace_id, title_id, kind) values (actor, new.workspace_id, new.id, 'added');
    return new;
  end if;
  -- Only forward moves count; going back and plain edits are not news.
  if new.status is distinct from old.status then
    if new.status = 'done' then k := 'completed';
    elsif new.status = 'in_progress' and old.status in ('queue', 'unreleased') then k := 'started';
    end if;
    if k is not null then
      insert into activity_events (actor_id, workspace_id, title_id, kind) values (actor, new.workspace_id, new.id, k);
    end if;
  end if;
  select count(*) into fresh from jsonb_object_keys(new.checked_parts) as key where not (coalesce(old.checked_parts, '{}'::jsonb) ? key);
  if fresh > 0 then
    insert into activity_events (actor_id, workspace_id, title_id, kind, payload)
    values (actor, new.workspace_id, new.id, 'parts', jsonb_build_object('count', fresh));
  end if;
  return new;
end $$;
create trigger titles_activity after insert or update on public.titles
  for each row execute function public.titles_activity();

-- The last 14 days of friends' (and board mates') activity, merged the way
-- the screen shows it: ticks of one title by one person on one day become a
-- line (dropped when they finished it that day), additions within an hour
-- become one line with covers. Days and hours are the viewer's (p_tz).
create or replace function public.feed(p_before timestamptz default now(), p_limit int default 60, p_tz text default 'UTC')
returns table (actor_id uuid, actor_name text, kind text, title_id text, workspace_id uuid, title text, category text, cover text,
               count int, covers json, at timestamptz, on_shared_board boolean)
language sql stable security definer set search_path = public as $$
with tz as (
  select case when exists (select 1 from pg_timezone_names where name = p_tz) then p_tz else 'UTC' end as name
),
visible as (
  select e.id, e.actor_id, e.workspace_id, e.title_id, e.kind, e.payload, e.created_at,
         (e.created_at at time zone tz.name) as local_at,
         t.title as t_title, t.category as t_category, t.cover as t_cover, w.kind as w_kind
  from activity_events e
  cross join tz
  join profiles p on p.id = e.actor_id and p.share_activity
  join workspaces w on w.id = e.workspace_id
  join titles t on t.workspace_id = e.workspace_id and t.id = e.title_id and not t.hidden
  where auth.uid() is not null
    and e.created_at < p_before and e.created_at > now() - interval '14 days'
    and e.actor_id <> auth.uid()
    and ((w.visibility <> 'private' and are_friends(e.actor_id, auth.uid())) or is_member(e.workspace_id))
),
singles as (
  select v.actor_id, v.kind, v.title_id, v.workspace_id, v.t_title, v.t_category, v.t_cover, 1 as cnt, null::json as covers, v.created_at as at, v.w_kind
  from visible v where v.kind in ('started', 'completed')
),
parts_day as (
  select v.actor_id, 'parts'::text as kind, v.title_id, v.workspace_id, max(v.t_title) as t_title, max(v.t_category) as t_category,
         max(v.t_cover) as t_cover, sum((v.payload->>'count')::int)::int as cnt, null::json as covers, max(v.created_at) as at, max(v.w_kind) as w_kind
  from visible v
  where v.kind = 'parts' and not exists (
    select 1 from visible c where c.kind = 'completed' and c.actor_id = v.actor_id and c.workspace_id = v.workspace_id
      and c.title_id = v.title_id and date_trunc('day', c.local_at) = date_trunc('day', v.local_at))
  group by v.actor_id, v.title_id, v.workspace_id, date_trunc('day', v.local_at)
),
added_hour as (
  select v.actor_id, 'added'::text as kind,
         (array_agg(v.title_id order by v.created_at desc))[1] as title_id,
         (array_agg(v.workspace_id order by v.created_at desc))[1] as workspace_id,
         (array_agg(v.t_title order by v.created_at desc))[1] as t_title,
         (array_agg(v.t_category order by v.created_at desc))[1] as t_category,
         (array_agg(v.t_cover order by v.created_at desc))[1] as t_cover,
         count(*)::int as cnt,
         json_agg(v.t_cover order by v.created_at desc) filter (where v.t_cover is not null) as covers,
         max(v.created_at) as at, max(v.w_kind) as w_kind
  from visible v where v.kind = 'added'
  group by v.actor_id, date_trunc('hour', v.local_at)
),
lines as (select * from singles union all select * from parts_day union all select * from added_hour)
select l.actor_id, display_name_of(p), l.kind, l.title_id, l.workspace_id, l.t_title, l.t_category, l.t_cover, l.cnt, l.covers, l.at, l.w_kind = 'shared'
from lines l join profiles p on p.id = l.actor_id
order by l.at desc
limit greatest(1, least(p_limit, 200));
$$;

create or replace function public.mark_feed_seen() returns void
language sql security definer set search_path = public as $$
  update profiles set feed_seen_at = now() where id = auth.uid();
$$;

-- The only notification there is (decision 38): new feed lines since the
-- Friends tab was last opened, plus everything waiting for an answer.
create or replace function public.badge_count() returns int
language sql stable security definer set search_path = public as $$
  select (select count(*) from feed(now(), 200) f where f.at > coalesce((select feed_seen_at from profiles where id = auth.uid()), '-infinity'))::int
       + (select count(*) from friend_requests where to_user = auth.uid())::int
       + (select count(*) from board_invites where to_user = auth.uid())::int;
$$;

do $$
declare f text;
begin
  foreach f in array array['public.feed(timestamptz,int,text)', 'public.mark_feed_seen()', 'public.badge_count()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'revoke execute on function public.titles_activity() from public, anon, authenticated';
end $$;
