-- matches() and friends_on_titles(): by title key, only what the friend's
-- privacy lets me see, and only with matches switched on by both.
begin;
select plan(10);
\ir support/social_fixture.sql
update public.workspaces set visibility = 'friends' where id = '00000000-0000-0000-0000-0000000000b2';
-- Same film under different slugs but one TMDb id; a slug-only title too.
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'batman-2022', 'queue', false, 'tmdb-movie', '414906');
select pg_temp.put('00000000-0000-0000-0000-0000000000b2', 'the-batman', 'in_progress', false, 'tmdb-movie', '414906');
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'dune-2021', 'queue');
select pg_temp.put('00000000-0000-0000-0000-0000000000b2', 'dune-2021', 'queue');
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'drive-2011', 'queue');
select pg_temp.put('00000000-0000-0000-0000-0000000000b2', 'drive-2011', 'done');
-- The other friend wants dune too, but their board is private.
select pg_temp.put('00000000-0000-0000-0000-0000000000b6', 'dune-2021', 'queue');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select results_eq($$select title_key, friend_status from public.matches() order by title_key$$,
  $$values ('slug:dune-2021'::text, 'queue'::text), ('tmdb-movie:414906'::text, 'in_progress'::text)$$, 'matched by key; a finished title is not a match');
select is((select count(*)::int from public.matches() where friend_id = '00000000-0000-0000-0000-0000000000a5'), 0, 'no match with a private board');
select results_eq($$select friend_name, status from public.friends_on_titles(array['tmdb-movie:414906', 'slug:drive-2011']) order by status$$,
  $$values ('Друг'::text, 'done'::text), ('Друг'::text, 'in_progress'::text)$$, 'friends on titles, by key');
select is((select count(*)::int from public.friends_on_titles(array['slug:dune-2021']) where friend_id = '00000000-0000-0000-0000-0000000000a5'), 0, 'private board stays out of «У друзей»');

reset role;
update public.titles set hidden = true where workspace_id = '00000000-0000-0000-0000-0000000000b2' and id = 'dune-2021';
set local role authenticated;
select is((select count(*)::int from public.matches() where title_key = 'slug:dune-2021'), 0, 'friend''s hidden title is not a match');
select is((select count(*)::int from public.friends_on_titles(array['slug:dune-2021'])), 0, 'nor on «У друзей»');

reset role;
update public.profiles set share_matches = false where id = '00000000-0000-0000-0000-0000000000a1';
set local role authenticated;
select is((select count(*)::int from public.matches()), 0, 'my matches off: nothing');
reset role;
update public.profiles set share_matches = true where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set share_matches = false where id = '00000000-0000-0000-0000-0000000000a2';
set local role authenticated;
select is((select count(*)::int from public.matches()), 0, 'their matches off: nothing');
reset role;
update public.profiles set share_matches = true where id = '00000000-0000-0000-0000-0000000000a2';
update public.titles set hidden = true where workspace_id = '00000000-0000-0000-0000-0000000000b1' and id = 'batman-2022';
set local role authenticated;
select is((select count(*)::int from public.matches() where title_key = 'tmdb-movie:414906'), 0, 'my own hidden title is not a match either');
select ok(not has_function_privilege('authenticated', 'public.my_friend_ids()', 'execute'), 'my_friend_ids is a helper');
select * from finish();
rollback;
