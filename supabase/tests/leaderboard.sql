-- leaderboard(): counted once per title key across a person's boards,
-- hidden titles and non-participants left out, seasons by tick dates.
begin;
select plan(11);
\ir support/social_fixture.sql
update public.profiles set in_leaderboard = true
 where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a4');
-- Me: one film on both my boards, a hidden one, one without a date, one finished last month.
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'dune', 'done', false, 'tmdb-movie', '438631');
select pg_temp.put('00000000-0000-0000-0000-0000000000b5', 'dune-2021', 'done', false, 'tmdb-movie', '438631');
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'secret', 'done', true);
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'old-v1', 'done');
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'last-month', 'done');
update public.titles set completed_at = now() where id in ('dune', 'dune-2021', 'secret');
update public.titles set completed_at = date_trunc('month', now()) - interval '1 day' where id = 'last-month';
-- Anime: two seasons ticked, one this month and one years ago; a finished series with no parts is one season.
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'frieren', 'in_progress', false, null, null, 'anime');
update public.titles set parts = '[{"name":"1"},{"name":"2"}]',
  checked_parts = jsonb_build_object('0', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '1', '2020-01-01T00:00:00Z') where id = 'frieren';
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'mini', 'done', false, null, null, 'anime');
update public.titles set completed_at = now() where id = 'mini';
-- The friend finished three films this month; the stranger (not taking part) ten.
select pg_temp.put('00000000-0000-0000-0000-0000000000b2', 'f' || g, 'done') from generate_series(1, 3) g;
update public.titles set completed_at = now() where workspace_id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.put('00000000-0000-0000-0000-0000000000b3', 's' || g, 'done') from generate_series(1, 10) g;
update public.titles set completed_at = now() where workspace_id = '00000000-0000-0000-0000-0000000000b3';

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
create temp view lb as select r->>'name' as name, (r->>'score')::int as score, (r->>'place')::int as place, (r->>'is_me')::boolean as is_me
  from json_array_elements(public.leaderboard('movie', 'month')->'rows') r;
select results_eq('select name, score, place from lb', $$values ('Друг'::text, 3, 1), ('Сосед'::text, 1, 2), ('Я'::text, 1, 2)$$,
  'a film on two boards counts once; hidden and last month do not; the shared board counts for each member');
select is((select count(*)::int from lb where name = 'stranger'), 0, 'someone not taking part is not listed');
select is((public.leaderboard('movie', 'all')->'me'->>'score')::int, 3, 'all time counts the undated and last month');
select is((public.leaderboard('movie', 'year')->'me'->>'score')::int,
  case when date_trunc('month', now()) = date_trunc('year', now()) then 1 else 2 end, 'year counts last month when it is this year');
select is((public.leaderboard('anime', 'month')->'me'->>'score')::int, 2, 'anime this month: one season ticked, one finished title without parts');
select is((public.leaderboard('anime', 'all')->'me'->>'score')::int, 3, 'anime all time: both ticks count');
select is((public.leaderboard('game', 'month')->'me')::jsonb, '{"score": 0, "place": null}'::jsonb, 'nothing done: my row with no place');
select is(json_array_length(public.leaderboard('game', 'month')->'rows'), 0, 'nobody with zero is listed');
select is((select is_me from lb where name = 'Я'), true, 'my row is marked');

select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(public.leaderboard('movie', 'month')::jsonb, '{"status": "off"}'::jsonb, 'not taking part: off, no rows');
reset role;
select is((select count(*)::int from pg_proc p where proname = 'leaderboard' and has_function_privilege('anon', p.oid, 'execute')), 0, 'anon cannot call it');
select * from finish();
rollback;
