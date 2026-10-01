-- Every social read against every kind of viewer (spec 7.4, plan D10):
-- my personal board at each visibility, one open and one hidden title,
-- seen by a friend, a stranger and a mate from my shared board; then each
-- privacy switch. A hidden title never shows; only a friend sees the feed,
-- matches and «У друзей».
begin;
select plan(52);
\ir support/social_fixture.sql
update public.profiles set share_activity = true, share_matches = true, findable_by_nick = true, in_leaderboard = false;
update public.workspaces set visibility = 'everyone' where id <> '00000000-0000-0000-0000-0000000000b1';
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'dune', 'queue');
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'secret', 'queue', true);
-- Every viewer wants both too, so matches and «У друзей» have something to find.
select pg_temp.put(w, t, 'queue') from (values ('00000000-0000-0000-0000-0000000000b2'::uuid), ('00000000-0000-0000-0000-0000000000b3'), ('00000000-0000-0000-0000-0000000000b4')) b(w),
  (values ('dune'), ('secret')) n(t);
-- One addition line in the feed for each title (the fixture backdates inserts, so the trigger stays quiet).
-- A minute old: feed() reads events before now(), and now() is fixed for the whole test transaction.
insert into public.activity_events (actor_id, workspace_id, title_id, kind, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'dune', 'added', now() - interval '1 minute'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'secret', 'added', now() - interval '1 minute');
-- Five finished films each, so the taste match has enough to compare.
select pg_temp.put(w, 'seen-' || g, 'done') from (values ('00000000-0000-0000-0000-0000000000b1'::uuid), ('00000000-0000-0000-0000-0000000000b2'),
  ('00000000-0000-0000-0000-0000000000b3'), ('00000000-0000-0000-0000-0000000000b4')) b(w), generate_series(1, 5) g;
-- For the leaderboard: a finished film.
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'drive', 'done');
update public.titles set completed_at = now() where id = 'drive';

-- My board: private.
update public.workspaces set visibility = 'private' where id = '00000000-0000-0000-0000-0000000000b1';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.friend_shelf('00000000-0000-0000-0000-0000000000a1', 'want')), 0, 'private / friend / shelf');
select is((select count(*)::int from public.friends_on_titles(array['slug:dune', 'slug:secret']) where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'private / friend / on');
select is((select count(*)::int from public.matches() where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'private / friend / matches');
select is((select coalesce(sum(count), 0)::int from public.feed() where actor_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'private / friend / feed');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a1')->>'status', 'not_enough', 'private / friend / taste');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.friend_shelf('00000000-0000-0000-0000-0000000000a1', 'want')), 0, 'private / stranger / shelf');
select is((select count(*)::int from public.friends_on_titles(array['slug:dune', 'slug:secret']) where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'private / stranger / on');
select is((select count(*)::int from public.matches() where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'private / stranger / matches');
select is((select coalesce(sum(count), 0)::int from public.feed() where actor_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'private / stranger / feed');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a1')->>'status', 'not_enough', 'private / stranger / taste');
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from public.friend_shelf('00000000-0000-0000-0000-0000000000a1', 'want')), 0, 'private / mate / shelf');
select is((select count(*)::int from public.friends_on_titles(array['slug:dune', 'slug:secret']) where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'private / mate / on');
select is((select count(*)::int from public.matches() where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'private / mate / matches');
select is((select coalesce(sum(count), 0)::int from public.feed() where actor_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'private / mate / feed');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a1')->>'status', 'not_enough', 'private / mate / taste');
reset role;

-- My board: friends.
update public.workspaces set visibility = 'friends' where id = '00000000-0000-0000-0000-0000000000b1';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.friend_shelf('00000000-0000-0000-0000-0000000000a1', 'want')), 1, 'friends / friend / shelf');
select is((select count(*)::int from public.friends_on_titles(array['slug:dune', 'slug:secret']) where friend_id = '00000000-0000-0000-0000-0000000000a1'), 1, 'friends / friend / on');
select is((select count(*)::int from public.matches() where friend_id = '00000000-0000-0000-0000-0000000000a1'), 1, 'friends / friend / matches');
select is((select coalesce(sum(count), 0)::int from public.feed() where actor_id = '00000000-0000-0000-0000-0000000000a1'), 1, 'friends / friend / feed');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a1')->>'status', 'ok', 'friends / friend / taste');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.friend_shelf('00000000-0000-0000-0000-0000000000a1', 'want')), 0, 'friends / stranger / shelf');
select is((select count(*)::int from public.friends_on_titles(array['slug:dune', 'slug:secret']) where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'friends / stranger / on');
select is((select count(*)::int from public.matches() where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'friends / stranger / matches');
select is((select coalesce(sum(count), 0)::int from public.feed() where actor_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'friends / stranger / feed');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a1')->>'status', 'not_enough', 'friends / stranger / taste');
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from public.friend_shelf('00000000-0000-0000-0000-0000000000a1', 'want')), 0, 'friends / mate / shelf');
select is((select count(*)::int from public.friends_on_titles(array['slug:dune', 'slug:secret']) where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'friends / mate / on');
select is((select count(*)::int from public.matches() where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'friends / mate / matches');
select is((select coalesce(sum(count), 0)::int from public.feed() where actor_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'friends / mate / feed');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a1')->>'status', 'not_enough', 'friends / mate / taste');
reset role;

-- My board: everyone.
update public.workspaces set visibility = 'everyone' where id = '00000000-0000-0000-0000-0000000000b1';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.friend_shelf('00000000-0000-0000-0000-0000000000a1', 'want')), 1, 'everyone / friend / shelf');
select is((select count(*)::int from public.friends_on_titles(array['slug:dune', 'slug:secret']) where friend_id = '00000000-0000-0000-0000-0000000000a1'), 1, 'everyone / friend / on');
select is((select count(*)::int from public.matches() where friend_id = '00000000-0000-0000-0000-0000000000a1'), 1, 'everyone / friend / matches');
select is((select coalesce(sum(count), 0)::int from public.feed() where actor_id = '00000000-0000-0000-0000-0000000000a1'), 1, 'everyone / friend / feed');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a1')->>'status', 'ok', 'everyone / friend / taste');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.friend_shelf('00000000-0000-0000-0000-0000000000a1', 'want')), 1, 'everyone / stranger / shelf');
select is((select count(*)::int from public.friends_on_titles(array['slug:dune', 'slug:secret']) where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'everyone / stranger / on');
select is((select count(*)::int from public.matches() where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'everyone / stranger / matches');
select is((select coalesce(sum(count), 0)::int from public.feed() where actor_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'everyone / stranger / feed');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a1')->>'status', 'ok', 'everyone / stranger / taste');
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from public.friend_shelf('00000000-0000-0000-0000-0000000000a1', 'want')), 1, 'everyone / mate / shelf');
select is((select count(*)::int from public.friends_on_titles(array['slug:dune', 'slug:secret']) where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'everyone / mate / on');
select is((select count(*)::int from public.matches() where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'everyone / mate / matches');
select is((select coalesce(sum(count), 0)::int from public.feed() where actor_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'everyone / mate / feed');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a1')->>'status', 'ok', 'everyone / mate / taste');
reset role;

-- Switches, with the board open to everyone.
update public.workspaces set visibility = 'everyone' where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set share_activity = false, share_matches = false, findable_by_nick = false, in_leaderboard = true where id = '00000000-0000-0000-0000-0000000000a1';
update public.workspaces set visibility = 'private' where id = '00000000-0000-0000-0000-0000000000b1';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select coalesce(sum(count), 0)::int from public.feed() where actor_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'activity off: nothing in the feed');
select is((select count(*)::int from public.matches() where friend_id = '00000000-0000-0000-0000-0000000000a1'), 0, 'matches off: no matches');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a1')::jsonb, '{"status": "disabled"}'::jsonb, 'matches off: no taste match');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from public.search_users('me_')), 0, 'not findable: search does not find me');
select is((select count(*)::int from json_array_elements(public.leaderboard('movie', 'all')->'rows') r where r->>'user_id' = '00000000-0000-0000-0000-0000000000a1'), 0,
  'the stranger is not taking part: they see no board at all');
reset role;
update public.profiles set in_leaderboard = true where id = '00000000-0000-0000-0000-0000000000a3';
set local role authenticated;
select is((select count(*)::int from json_array_elements(public.leaderboard('movie', 'all')->'rows') r where r->>'user_id' = '00000000-0000-0000-0000-0000000000a1'), 1,
  'taking part shows my number to everyone taking part, even with my board private');
reset role;
update public.profiles set findable_by_nick = true where id = '00000000-0000-0000-0000-0000000000a1';
set local role authenticated;
select is((select count(*)::int from public.search_users('me_')), 1, 'findable: found by nick');

select * from finish();
rollback;
