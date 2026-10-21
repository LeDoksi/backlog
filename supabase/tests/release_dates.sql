-- BL-117: the quiet refresh write carries release dates, platforms and
-- season_info; a base naming them guards them like the other card fields.
begin;
select plan(9);
\ir support/social_fixture.sql
update public.workspaces set visibility = 'friends' where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'dune-3', 'queue', false, 'tmdb-movie', '1170608', 'movie');
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'silksong', 'queue', false, 'steam', '1030300', 'game');
update public.titles set season_info = 'старый текст' where id = 'silksong';

create temp table ev as select count(*) as n from public.activity_events;
grant select on ev to authenticated;
create function pg_temp.events() returns bigint language sql security definer as $$
  select (select count(*) from public.activity_events) - (select n from ev);
$$;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1',
  '[{"id":"dune-3","base":{"parts":null,"checked_parts":{},"status":"queue","release_date":null},"status":"unreleased","release_date":"2026-12-18","digital_date":null}]'),
  1, 'a film gets its dates and the badge');
select is((select status || '|' || release_date::text || '|' || coalesce(digital_date::text, '-') from public.titles where id = 'dune-3'),
  'unreleased|2026-12-18|-', 'stored');
select is(pg_temp.events(), 0::bigint, 'no feed events');

select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1',
  '[{"id":"silksong","base":{"parts":null,"checked_parts":{},"status":"queue","platforms":null,"season_info":"старый текст"},"platforms":["PC","Switch"],"release_date":"2025-09-04","season_info":null}]'),
  1, 'platforms, a game date, season_info cleared');
select is((select platforms::text || '|' || release_date::text || '|' || coalesce(season_info, '-') from public.titles where id = 'silksong'),
  '["PC", "Switch"]|2025-09-04|-', 'stored');

-- Absent keys leave the columns alone.
select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1',
  '[{"id":"silksong","base":{"parts":null,"checked_parts":{},"status":"queue"},"year":2025}]'),
  1, 'another field only');
select is((select release_date::text || '|' || platforms::text from public.titles where id = 'silksong'), '2025-09-04|["PC", "Switch"]', 'dates and platforms kept');

-- A base with an older date is stale.
select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1',
  '[{"id":"dune-3","base":{"parts":null,"checked_parts":{},"status":"unreleased","release_date":"2026-11-01"},"release_date":"2027-01-01"}]'),
  -1, 'a changed date makes the call stale');
select is((select release_date::text from public.titles where id = 'dune-3'), '2026-12-18', 'and nothing changed');
select * from finish();
rollback;
