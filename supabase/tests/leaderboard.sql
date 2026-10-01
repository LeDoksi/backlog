-- leaderboard(): one row per board, personal and shared never mixed,
-- hidden titles and non-participants left out, seasons by tick dates.
begin;
select plan(19);
\ir support/social_fixture.sql
update public.profiles set in_leaderboard = true
 where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a4');
update public.workspaces set in_leaderboard = true where id = '00000000-0000-0000-0000-0000000000b5';
update public.workspace_members set joined_at = now() + interval '1 second'
 where workspace_id = '00000000-0000-0000-0000-0000000000b5' and user_id = '00000000-0000-0000-0000-0000000000a4';
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
create temp view lb as select r->>'name' as name, (r->>'score')::int as score, (r->>'place')::int as place, (r->>'mine')::boolean as mine, r->>'kind' as kind
  from json_array_elements(public.leaderboard('movie', 'month')->'rows') r;
create temp view mine as select m->>'name' as name, (m->>'score')::int as score, (m->>'place')::int as place
  from json_array_elements(public.leaderboard('movie', 'all')->'mine') m;
select results_eq('select name, score, place from lb', $$values ('Друг'::text, 3, 1), ('Я'::text, 1, 2), ('Я + Сосед'::text, 1, 2)$$,
  'personal and shared boards are separate rows; hidden and last month do not count; a mate with nothing is not listed');
select results_eq('select name, mine from lb where mine', $$values ('Я'::text, true), ('Я + Сосед'::text, true)$$, 'my boards are marked');
select is((select count(*)::int from lb where name = 'stranger'), 0, 'someone not taking part is not listed');
select results_eq('select name, score from mine', $$values ('Я'::text, 3), ('Я + Сосед'::text, 1)$$,
  'all time: the personal board counts the undated and last month, the shared board only its own title');
select is((public.leaderboard('movie', 'year')->'mine'->0->>'score')::int,
  case when date_trunc('month', now()) = date_trunc('year', now()) then 1 else 2 end, 'year counts last month when it is this year');
select is((public.leaderboard('anime', 'month')->'mine'->0->>'score')::int, 2, 'anime this month: one season ticked, one finished title without parts');
select is((public.leaderboard('anime', 'all')->'mine'->0->>'score')::int, 3, 'anime all time: both ticks count');
select is((public.leaderboard('game', 'month')->'mine'->0)::jsonb - 'board_id',
  '{"kind": "personal", "name": "Я", "score": 0, "place": null}'::jsonb, 'nothing done: my row with no place');
select is(json_array_length(public.leaderboard('game', 'month')->'rows'), 0, 'nobody with zero is listed');

-- The shared board's switch: any member, shared boards only.
select throws_ok($$select public.set_board_leaderboard('00000000-0000-0000-0000-0000000000b1', true)$$, 'P0001', 'not_shared', 'a personal board has no switch of its own');
select throws_ok($$select public.set_board_leaderboard('00000000-0000-0000-0000-0000000000b2', true)$$, 'P0001', 'not_member', 'only a member flips it');
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select public.set_board_leaderboard('00000000-0000-0000-0000-0000000000b5', false);
select is((select in_leaderboard from public.my_boards() where kind = 'shared'), false, 'the mate switched the shared board off');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from json_array_elements(public.leaderboard('movie', 'month')->'rows') r where r->>'kind' = 'shared'), 0,
  'a shared board switched off is not listed');
reset role;
update public.profiles set in_leaderboard = false where id = '00000000-0000-0000-0000-0000000000a4';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is(public.leaderboard('movie', 'month')::jsonb, '{"status": "off"}'::jsonb, 'none of my boards take part: off');

select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(public.leaderboard('movie', 'month')::jsonb, '{"status": "off"}'::jsonb, 'not taking part: off, no rows');
reset role;
-- A change of members switches the shared board off: a newcomer never lands in the leaders unasked.
update public.workspaces set in_leaderboard = true where id = '00000000-0000-0000-0000-0000000000b5';
insert into public.workspace_members (workspace_id, user_id) values ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000a5');
select is((select in_leaderboard from public.workspaces where id = '00000000-0000-0000-0000-0000000000b5'), false, 'someone joining switches it off');
update public.workspaces set in_leaderboard = true where id = '00000000-0000-0000-0000-0000000000b5';
delete from public.workspace_members where workspace_id = '00000000-0000-0000-0000-0000000000b5' and user_id = '00000000-0000-0000-0000-0000000000a5';
select is((select in_leaderboard from public.workspaces where id = '00000000-0000-0000-0000-0000000000b5'), false, 'someone leaving switches it off');
select is((select count(*)::int from pg_proc p where proname = 'leaderboard' and has_function_privilege('anon', p.oid, 'execute')), 0, 'anon cannot call it');
select is((select count(*)::int from pg_proc p where proname = 'set_board_leaderboard' and has_function_privilege('anon', p.oid, 'execute')), 0, 'anon cannot flip it');
select * from finish();
rollback;
