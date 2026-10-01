-- Leaders by board (Georgy, 2026-10-01): a personal board and a shared one
-- are separate rows, «Гоша», «Даша», «Гоша + Даша», and their titles are
-- never mixed. A personal board takes part when its owner switched
-- in_leaderboard on; a shared board has its own switch any member can flip.
-- Also: copying a title from a friend's shelf onto one of my boards.
alter table public.workspaces add column in_leaderboard boolean not null default false;

create or replace function public.set_board_leaderboard(p_workspace uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_workspace) then raise exception 'not_member' using errcode = 'P0001'; end if;
  if not exists (select 1 from workspaces where id = p_workspace and kind = 'shared') then
    raise exception 'not_shared' using errcode = 'P0001';
  end if;
  update workspaces set in_leaderboard = p_on where id = p_workspace;
end $$;

-- my_boards() gains the shared board's switch.
drop function public.my_boards();
create function public.my_boards() returns table (id uuid, kind text, visibility text, title_count int, members json, in_leaderboard boolean)
language sql stable security definer set search_path = public as $$
  select w.id, w.kind, w.visibility,
    (select count(*)::int from titles t where t.workspace_id = w.id),
    (select json_agg(json_build_object('id', p.id, 'name', coalesce(p.display_name, split_part(p.email, '@', 1)), 'nickname', p.nickname, 'email', p.email) order by m2.joined_at)
       from workspace_members m2 join profiles p on p.id = m2.user_id where m2.workspace_id = w.id),
    w.in_leaderboard
  from workspaces w join workspace_members m on m.workspace_id = w.id
  where m.user_id = auth.uid()
  order by (w.kind = 'shared');
$$;

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

-- A title from what a friend shows me, onto one of my boards, as «хочу»
-- (or «не вышло»). Only titles visible_titles_for lets me see qualify.
create or replace function public.copy_from_friend(p_owner uuid, p_title_id text, p_to uuid) returns void
language plpgsql security definer set search_path = public as $$
declare src titles;
begin
  if not is_member(p_to) then raise exception 'not_member' using errcode = 'P0001'; end if;
  select * into src from visible_titles_for(p_owner, auth.uid()) v
   where v.id = p_title_id and p_owner <> auth.uid() limit 1;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if exists (select 1 from titles t where t.workspace_id = p_to and (t.id = src.id
      or (src.source is not null and t.source = src.source and t.source_id = src.source_id))) then
    raise exception 'duplicate' using errcode = 'P0001';
  end if;
  insert into titles (workspace_id, id, title, original_title, category, status, airing_status, year, genres, synopsis,
                      cover, season_info, platforms, parts, source, source_id)
  values (p_to, src.id, src.title, src.original_title, src.category,
          case when src.status = 'unreleased' then 'unreleased' else 'queue' end,
          src.airing_status, src.year, src.genres, src.synopsis, src.cover, src.season_info, src.platforms, src.parts,
          src.source, src.source_id);
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.set_board_leaderboard(uuid,boolean)', 'public.my_boards()', 'public.leaderboard(text,text)',
                           'public.copy_from_friend(uuid,text,uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
