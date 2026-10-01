-- copy_from_friend(): only what the friend shows me, onto my own boards,
-- as «хочу», never twice.
begin;
select plan(9);
\ir support/social_fixture.sql
update public.workspaces set visibility = 'friends' where id = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.put('00000000-0000-0000-0000-0000000000b2', 'arrival', 'done', false, 'tmdb-movie', '329865');
select pg_temp.put('00000000-0000-0000-0000-0000000000b2', 'dune-3', 'unreleased');
select pg_temp.put('00000000-0000-0000-0000-0000000000b2', 'secret', 'queue', true);
select pg_temp.put('00000000-0000-0000-0000-0000000000b3', 'private-one', 'queue');
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'arrival-mine', 'queue', false, 'tmdb-movie', '329865');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.copy_from_friend('00000000-0000-0000-0000-0000000000a2', 'arrival', '00000000-0000-0000-0000-0000000000b5')$$,
  'a friend''s title goes onto my shared board');
reset role;
select is((select status from public.titles where workspace_id = '00000000-0000-0000-0000-0000000000b5' and id = 'arrival'), 'queue', 'a finished title arrives as «хочу»');
set local role authenticated;
select public.copy_from_friend('00000000-0000-0000-0000-0000000000a2', 'dune-3', '00000000-0000-0000-0000-0000000000b1');
reset role;
select is((select status from public.titles where workspace_id = '00000000-0000-0000-0000-0000000000b1' and id = 'dune-3'), 'unreleased', 'an unreleased title stays «не вышло»');
set local role authenticated;
select throws_ok($$select public.copy_from_friend('00000000-0000-0000-0000-0000000000a2', 'arrival', '00000000-0000-0000-0000-0000000000b1')$$,
  'P0001', 'duplicate', 'the same title by source is already on the board');
select throws_ok($$select public.copy_from_friend('00000000-0000-0000-0000-0000000000a2', 'secret', '00000000-0000-0000-0000-0000000000b1')$$,
  'P0001', 'not_found', 'a hidden title cannot be copied');
select throws_ok($$select public.copy_from_friend('00000000-0000-0000-0000-0000000000a3', 'private-one', '00000000-0000-0000-0000-0000000000b1')$$,
  'P0001', 'not_found', 'a private board cannot be copied from');
select throws_ok($$select public.copy_from_friend('00000000-0000-0000-0000-0000000000a2', 'dune-3', '00000000-0000-0000-0000-0000000000b2')$$,
  'P0001', 'not_member', 'only onto my own boards');
select throws_ok($$select public.copy_from_friend('00000000-0000-0000-0000-0000000000a1', 'arrival-mine', '00000000-0000-0000-0000-0000000000b5')$$,
  'P0001', 'not_found', 'not from myself');
reset role;
select is((select count(*)::int from pg_proc p where proname = 'copy_from_friend' and has_function_privilege('anon', p.oid, 'execute')), 0, 'anon cannot call it');
select * from finish();
rollback;
