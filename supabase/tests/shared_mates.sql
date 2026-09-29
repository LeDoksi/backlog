-- Review fixes: a friend who is also on my shared board. A title on that
-- board is one row with one status, not two people's taste: it is not a
-- match, puts no avatar on the card, and does not feed the taste match.
begin;
select plan(6);
\ir support/social_fixture.sql
-- The mate (a4) becomes a friend too.
insert into public.friendships (user_a, user_b) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a4');
update public.workspaces set visibility = 'friends' where id = '00000000-0000-0000-0000-0000000000b4';
-- Five titles on the shared board, wanted there.
select pg_temp.put('00000000-0000-0000-0000-0000000000b5', 'shared-' || g, 'queue') from generate_series(1, 5) g;
-- One title the mate also has on their own board: that one is theirs.
select pg_temp.put('00000000-0000-0000-0000-0000000000b4', 'shared-1', 'queue');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select results_eq($$select title_key from public.matches() where friend_id = '00000000-0000-0000-0000-0000000000a4'$$,
  $$values ('slug:shared-1'::text)$$, 'only the title on the mate''s own board is a match');
select results_eq($$select title_key from public.friends_on_titles(array['slug:shared-1', 'slug:shared-2', 'slug:shared-3'])$$,
  $$values ('slug:shared-1'::text)$$, 'no avatar on shared-board cards, only where the mate has it themselves');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a4')->>'status', 'not_enough', 'shared-board rows do not make a taste match');
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select results_eq($$select title_key from public.matches() where friend_id = '00000000-0000-0000-0000-0000000000a1'$$,
  $$select 'x'::text where false$$, 'from the mate''s side: my shelf is only the shared board, no matches');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a1')->>'status', 'not_enough', 'same from the other side');
-- A friend who is not on the board still sees the shared titles as mine.
reset role;
update public.workspaces set visibility = 'friends' where id = '00000000-0000-0000-0000-0000000000b5';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.friends_on_titles(array['slug:shared-2']) where friend_id = '00000000-0000-0000-0000-0000000000a1'), 1,
  'someone outside the board still sees it on my shelf');
select * from finish();
rollback;
