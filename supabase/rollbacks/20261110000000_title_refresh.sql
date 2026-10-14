-- Undo 20261110000000_title_refresh.

drop function public.apply_title_refresh(uuid, jsonb, jsonb);
drop function public.refresh_base_ok(public.titles, jsonb);

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
  -- A malformed checklist (not an object) is not news, and must not block the write.
  if jsonb_typeof(new.checked_parts) = 'object' then
    select count(*) into fresh from jsonb_object_keys(new.checked_parts) as key
      where not (case when jsonb_typeof(old.checked_parts) = 'object' then old.checked_parts else '{}'::jsonb end ? key);
  end if;
  if fresh > 0 then
    insert into activity_events (actor_id, workspace_id, title_id, kind, payload)
    values (actor, new.workspace_id, new.id, 'parts', jsonb_build_object('count', fresh));
  end if;
  return new;
end $$;


-- Spec 7.5 scoring, per board: films and games count finished titles, series
-- and anime count ticked seasons (a finished title without parts is one
-- season); hidden titles never count. 'off' when none of my boards take part.
create or replace function public.leaderboard(p_category text, p_period text) returns json
language sql stable security definer set search_path = public as $$
with since as (
  select case p_period when 'month' then date_trunc('month', now()) when 'year' then date_trunc('year', now()) end as ts
),
boards as (
  select w.id, w.kind,
    (select string_agg(display_name_of(p), ' + ' order by m.joined_at, m.user_id)
       from workspace_members m join profiles p on p.id = m.user_id where m.workspace_id = w.id) as name,
    (select json_agg(m.user_id order by m.joined_at, m.user_id) from workspace_members m where m.workspace_id = w.id) as members,
    exists (select 1 from workspace_members m where m.workspace_id = w.id and m.user_id = auth.uid()) as mine
  from workspaces w
  where (w.kind = 'shared' and w.in_leaderboard)
     or (w.kind = 'personal' and exists (select 1 from workspace_members m join profiles p on p.id = m.user_id
                                         where m.workspace_id = w.id and p.in_leaderboard))
),
own as (
  select b.id as bid, title_key(t.source, t.source_id, t.id) as k, t.status, t.completed_at, t.parts, t.checked_parts
  from boards b join titles t on t.workspace_id = b.id
  where t.category = p_category and not t.hidden
),
-- Undated titles (moved over from v1) count only for all time.
whole as (
  select o.bid, count(distinct o.k) as n
  from own o cross join since
  where o.status = 'done' and (since.ts is null or o.completed_at >= since.ts)
    and (p_category in ('movie', 'game') or coalesce(case when jsonb_typeof(o.parts) = 'array' then jsonb_array_length(o.parts) end, 0) = 0)
  group by o.bid
),
seasons as (
  select o.bid, count(distinct (o.k, cp.key)) as n
  from own o
  cross join lateral jsonb_each_text(case when jsonb_typeof(o.checked_parts) = 'object' then o.checked_parts else '{}'::jsonb end) cp
  cross join since
  where p_category in ('series', 'anime')
    and (since.ts is null or safe_timestamptz(cp.value) >= since.ts)
  group by o.bid
),
scores as (
  select b.id, b.kind, b.name, b.members, b.mine, (coalesce(w.n, 0) + coalesce(s.n, 0))::int as score
  from boards b left join whole w on w.bid = b.id left join seasons s on s.bid = b.id
),
ranked as (select id, (rank() over (order by score desc))::int as place from scores where score > 0)
select case
  when auth.uid() is null or not exists (select 1 from boards where mine) then json_build_object('status', 'off')
  else json_build_object(
    'status', 'ok',
    'rows', coalesce((select json_agg(json_build_object('board_id', x.id, 'kind', x.kind, 'name', x.name, 'members', x.members,
                                                        'score', x.score, 'place', x.place, 'mine', x.mine) order by x.place, x.name)
                      from (select sc.*, r.place from scores sc join ranked r on r.id = sc.id order by r.place, sc.name limit 10) x), '[]'::json),
    'mine', (select json_agg(json_build_object('board_id', sc.id, 'kind', sc.kind, 'name', sc.name, 'score', sc.score, 'place', r.place)
                             order by (sc.kind = 'shared'), sc.name)
             from scores sc left join ranked r on r.id = sc.id where sc.mine))
end;
$$;


drop function public.friend_title(uuid, text, uuid);
create function public.friend_title(p_owner uuid, p_id text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', t.id, 'title', t.title, 'original_title', t.original_title, 'category', t.category,
    'year', t.year, 'genres', t.genres, 'synopsis', t.synopsis, 'cover', t.cover, 'platforms', t.platforms,
    'parts', t.parts, 'checked', coalesce((select json_agg(k::int order by k::int) from jsonb_object_keys(t.checked_parts) k where k ~ '^[0-9]+$'), '[]'::json),
    'status', t.status, 'rating', t.rating, 'title_key', title_key(t.source, t.source_id, t.id),
    'mine_id', (select m.id from visible_titles(auth.uid()) m
                where title_key(m.source, m.source_id, m.id) = title_key(t.source, t.source_id, t.id) limit 1))
  from visible_titles_for(p_owner, auth.uid()) t
  where t.id = p_id and auth.uid() is not null
  limit 1;
$$;
revoke execute on function public.friend_title(uuid, text) from public, anon;
grant execute on function public.friend_title(uuid, text) to authenticated, service_role;

alter table public.titles drop column parts_manual;
