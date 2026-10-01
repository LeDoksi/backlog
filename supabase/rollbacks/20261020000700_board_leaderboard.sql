-- Undo 20261020000700_board_leaderboard: per-person leaders, my_boards
-- without the switch, no copying from friends.
drop function if exists public.copy_from_friend(uuid, text, uuid);
drop function if exists public.set_board_leaderboard(uuid, boolean);
drop function public.my_boards();
create function public.my_boards() returns table (id uuid, kind text, visibility text, title_count int, members json)
language sql stable security definer set search_path = public as $$
  select w.id, w.kind, w.visibility,
    (select count(*)::int from titles t where t.workspace_id = w.id),
    (select json_agg(json_build_object('id', p.id, 'name', coalesce(p.display_name, split_part(p.email, '@', 1)), 'nickname', p.nickname, 'email', p.email) order by m2.joined_at)
       from workspace_members m2 join profiles p on p.id = m2.user_id where m2.workspace_id = w.id)
  from workspaces w join workspace_members m on m.workspace_id = w.id
  where m.user_id = auth.uid()
  order by (w.kind = 'shared');
$$;
revoke execute on function public.my_boards() from public, anon;
grant execute on function public.my_boards() to authenticated, service_role;

create or replace function public.leaderboard(p_category text, p_period text) returns json
language sql stable security definer set search_path = public as $$
with since as (
  select case p_period when 'month' then date_trunc('month', now()) when 'year' then date_trunc('year', now()) end as ts
),
people as (select p.id, display_name_of(p) as name from profiles p where p.in_leaderboard),
own as (
  select pe.id as uid, title_key(t.source, t.source_id, t.id) as k, t.status, t.completed_at, t.parts, t.checked_parts
  from people pe
  join workspace_members m on m.user_id = pe.id
  join titles t on t.workspace_id = m.workspace_id
  where t.category = p_category and not t.hidden
),
-- Undated titles (moved over from v1) count only for all time.
whole as (
  select o.uid, count(distinct o.k) as n
  from own o cross join since
  where o.status = 'done' and (since.ts is null or o.completed_at >= since.ts)
    and (p_category in ('movie', 'game') or coalesce(case when jsonb_typeof(o.parts) = 'array' then jsonb_array_length(o.parts) end, 0) = 0)
  group by o.uid
),
seasons as (
  select o.uid, count(distinct (o.k, cp.key)) as n
  from own o
  cross join lateral jsonb_each_text(case when jsonb_typeof(o.checked_parts) = 'object' then o.checked_parts else '{}'::jsonb end) cp
  cross join since
  where p_category in ('series', 'anime')
    and (since.ts is null or safe_timestamptz(cp.value) >= since.ts)
  group by o.uid
),
scores as (
  select pe.id, pe.name, (coalesce(w.n, 0) + coalesce(s.n, 0))::int as score
  from people pe left join whole w on w.uid = pe.id left join seasons s on s.uid = pe.id
),
ranked as (select id, name, score, (rank() over (order by score desc))::int as place from scores where score > 0)
select case
  when auth.uid() is null or not exists (select 1 from people where id = auth.uid()) then json_build_object('status', 'off')
  else json_build_object(
    'status', 'ok',
    'rows', coalesce((select json_agg(json_build_object('user_id', r.id, 'name', r.name, 'score', r.score, 'place', r.place, 'is_me', r.id = auth.uid())
                                      order by r.place, r.name)
                      from (select * from ranked order by place, name limit 10) r), '[]'::json),
    'me', (select json_build_object('score', sc.score, 'place', r.place) from scores sc left join ranked r on r.id = sc.id where sc.id = auth.uid()))
end;
$$;

revoke execute on function public.leaderboard(text, text) from public, anon;
grant execute on function public.leaderboard(text, text) to authenticated, service_role;
alter table public.workspaces drop column in_leaderboard;
