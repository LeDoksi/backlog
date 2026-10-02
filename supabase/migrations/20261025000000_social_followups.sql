-- Loose ends of phase D (plan D, «Отклонения при реализации»):
-- two people asking each other at once got two requests instead of a
-- friendship (now every friendship change locks the pair); taste_match told a stranger's match setting to anyone; a link
-- did not record who followed it (spec 8); feed() scanned pg_timezone_names
-- (75-860 ms on the live project) on every call.

create table public.invite_redemptions (
  token text not null references public.invite_links(token) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome text not null,
  redeemed_at timestamptz not null default now(),
  primary key (token, user_id)
);
create index invite_redemptions_user_idx on public.invite_redemptions (user_id);
alter table public.invite_redemptions enable row level security;
revoke all on table public.invite_redemptions from anon, authenticated;

-- An IANA zone name the server knows ('Europe/Moscow'), else UTC. Trying it
-- is cheap; listing them all is not. Names without a slash ('MSK', 'UTC+3')
-- are fixed offsets or POSIX rules with the sign flipped, so they are refused.
create function public.safe_tz(p_tz text) returns text
language plpgsql stable set search_path = public as $$
begin
  if p_tz is null or position('/' in p_tz) = 0 then return 'UTC'; end if;
  perform now() at time zone p_tz;
  return p_tz;
exception when others then
  return 'UTC';
end $$;
revoke execute on function public.safe_tz(text) from public, anon, authenticated;
grant execute on function public.safe_tz(text) to service_role;

-- Everything that changes the friendship of two people goes one pair at a
-- time: two people acting on each other at the same moment would otherwise
-- each miss the other's uncommitted change.
create function public.lock_pair(a uuid, b uuid) returns void
language sql volatile set search_path = public as $$
  select pg_advisory_xact_lock(hashtextextended(least(a, b)::text || greatest(a, b)::text, 0));
$$;
revoke execute on function public.lock_pair(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lock_pair(uuid, uuid) to service_role;

create or replace function public.request_friendship(p_from uuid, p_to uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_from = p_to then return 'self'; end if;
  perform lock_pair(p_from, p_to);
  if are_friends(p_from, p_to) then return 'already_friends'; end if;
  if exists (select 1 from friend_requests where from_user = p_to and to_user = p_from) then
    insert into friendships (user_a, user_b) values (least(p_from, p_to), greatest(p_from, p_to)) on conflict do nothing;
    delete from friend_requests where (from_user, to_user) in ((p_from, p_to), (p_to, p_from));
    return 'friends';
  end if;
  insert into friend_requests (from_user, to_user) values (p_from, p_to) on conflict (from_user, to_user) do nothing;
  return 'requested';
end $$;

create or replace function public.respond_friend_request(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r friend_requests;
begin
  select * into r from friend_requests where id = p_id and to_user = auth.uid();
  if not found then return; end if;
  perform lock_pair(r.from_user, r.to_user);
  delete from friend_requests where id = p_id;
  if not found then return; end if;
  if p_accept then
    insert into friendships (user_a, user_b) values (least(r.from_user, r.to_user), greatest(r.from_user, r.to_user)) on conflict do nothing;
    delete from friend_requests where from_user = r.to_user and to_user = r.from_user;
  end if;
end $$;

create or replace function public.remove_friend(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  perform lock_pair(p_user, auth.uid());
  delete from friendships where user_a = least(p_user, auth.uid()) and user_b = greatest(p_user, auth.uid());
end $$;

create or replace function public.redeem_invite(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare
  inviter uuid;
  outcome text;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select created_by into inviter from invite_links where token = lower(trim(p_token)) and expires_at > now();
  if inviter is null then return json_build_object('status', 'expired'); end if;
  outcome := request_friendship(inviter, auth.uid());
  if outcome <> 'self' then
    insert into invite_redemptions (token, user_id, outcome) values (lower(trim(p_token)), auth.uid(), outcome)
    on conflict (token, user_id) do nothing;
  end if;
  return json_build_object('status', outcome,
    'from_name', (select display_name_of(p) from profiles p where p.id = inviter));
end $$;

create or replace function public.taste_match(p_user uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  d1 text[]; d2 text[]; w1 text[]; w2 text[]; n1 int; n2 int;
  common int; both_want int;
  t numeric; g numeric; w numeric; top text[];
  score numeric := 0; weight numeric := 0;
begin
  if me is null or p_user = me then return json_build_object('status', 'disabled'); end if;
  -- Someone without a page for me gets the same answer whatever their
  -- switches say, so the call cannot be used to read anyone's settings.
  if friend_profile(p_user) is null then return json_build_object('status', 'not_enough'); end if;
  if not coalesce((select share_matches from profiles where id = p_user), false)
     or not coalesce((select share_matches from profiles where id = me), false) then
    return json_build_object('status', 'disabled');
  end if;
  select count(*), coalesce(array_agg(title_key(x.source, x.source_id, x.id)) filter (where x.status = 'done'), '{}'),
         coalesce(array_agg(title_key(x.source, x.source_id, x.id)) filter (where x.status = 'queue'), '{}')
    into n1, d1, w1 from visible_titles_for(me, p_user) x where not x.hidden and not on_common_board(x.workspace_id, me, p_user);
  select count(*), coalesce(array_agg(title_key(x.source, x.source_id, x.id)) filter (where x.status = 'done'), '{}'),
         coalesce(array_agg(title_key(x.source, x.source_id, x.id)) filter (where x.status = 'queue'), '{}')
    into n2, d2, w2 from visible_titles_for(p_user, me) x where not x.hidden and not on_common_board(x.workspace_id, me, p_user);
  if n1 < 5 or n2 < 5 then return json_build_object('status', 'not_enough'); end if;

  common := cardinality(array(select unnest(d1) intersect select unnest(d2)));
  both_want := cardinality(array(select unnest(w1) intersect select unnest(w2)));

  -- T: cosine of the finished sets.
  if cardinality(d1) > 0 and cardinality(d2) > 0 then
    t := common / sqrt(cardinality(d1)::numeric * cardinality(d2));
  end if;

  -- G: cosine of genre counts over finished and in-progress titles.
  with a as (select gg, count(*)::numeric c from visible_titles_for(me, p_user) x, jsonb_array_elements_text(x.genres) gg
             where not x.hidden and not on_common_board(x.workspace_id, me, p_user) and x.status in ('done', 'in_progress') group by gg),
       b as (select gg, count(*)::numeric c from visible_titles_for(p_user, me) x, jsonb_array_elements_text(x.genres) gg
             where not x.hidden and not on_common_board(x.workspace_id, me, p_user) and x.status in ('done', 'in_progress') group by gg),
       na as (select sqrt(sum(c * c)) n from a), nb as (select sqrt(sum(c * c)) n from b)
  select coalesce((select sum(a.c * b.c) from a join b using (gg)), 0) / nullif((select n from na) * (select n from nb), 0),
         (select array_agg(gg order by m desc, gg) from (select a.gg, least(a.c, b.c) m from a join b using (gg) order by m desc, a.gg limit 3) z)
    into g, top;

  -- W: how much of each one's "want" the other already wants or finished,
  -- so identical shelves give 1 (the spec's normalisation could not).
  if cardinality(w1) + cardinality(w2) > 0 then
    w := (cardinality(array(select unnest(w1) intersect select unnest(w2 || d2)))
        + cardinality(array(select unnest(w2) intersect select unnest(w1 || d1))))::numeric
       / (cardinality(w1) + cardinality(w2));
  end if;

  -- A part neither side has data for (nobody finished anything, no genres,
  -- nobody wants anything) is left out and the weights re-balanced.
  if t is not null then score := score + 0.6 * t; weight := weight + 0.6; end if;
  if g is not null then score := score + 0.3 * g; weight := weight + 0.3; end if;
  if w is not null then score := score + 0.1 * w; weight := weight + 0.1; end if;

  return json_build_object('status', 'ok',
    'percent', case when weight = 0 then 0 else round(100 * score / weight)::int end,
    'common', common, 'both_want', both_want, 'genres', coalesce(to_json(top), '[]'::json));
end $$;

create or replace function public.feed(p_before timestamptz default now(), p_limit int default 60, p_tz text default 'UTC')
returns table (actor_id uuid, actor_name text, kind text, title_id text, workspace_id uuid, title text, category text, cover text,
               count int, covers json, at timestamptz, on_shared_board boolean)
language sql stable security definer set search_path = public as $$
with tz as materialized (
  select safe_tz(p_tz) as name
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
