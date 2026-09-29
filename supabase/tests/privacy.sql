-- Board visibility is changed by any member and nobody else; the switches
-- touch only the caller's profile; hidden titles are listed from both boards.
begin;
select plan(9);
\ir support/social_fixture.sql
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'a-2000', 'queue', true);
select pg_temp.put('00000000-0000-0000-0000-0000000000b5', 'b-2001', 'queue', true);
select pg_temp.put('00000000-0000-0000-0000-0000000000b5', 'c-2002');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select lives_ok($$select public.set_board_visibility('00000000-0000-0000-0000-0000000000b5', 'friends')$$, 'any member changes the shared board');
select throws_like($$select public.set_board_visibility('00000000-0000-0000-0000-0000000000b1', 'everyone')$$, 'not_member', 'nobody else can');
select throws_like($$select public.set_board_visibility('00000000-0000-0000-0000-0000000000b4', 'open')$$, 'bad_visibility', 'only three levels');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select visibility from public.my_boards() where kind = 'shared'), 'friends', 'the other member sees the change');
select public.set_privacy(true, false, false, false);
select is(public.my_profile()->>'in_leaderboard', 'true', 'switches are saved');
select is((public.my_profile()->>'share_activity') || (public.my_profile()->>'share_matches') || (public.my_profile()->>'findable_by_nick'), 'falsefalsefalse', 'all four');
select results_eq($$select id from public.my_hidden_titles() order by id$$, $$values ('a-2000'::text), ('b-2001'::text)$$, 'hidden titles from both boards');
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select results_eq($$select id from public.my_hidden_titles()$$, $$values ('b-2001'::text)$$, 'mate sees only the shared one');
reset role;
select is((select in_leaderboard from public.profiles where id = '00000000-0000-0000-0000-0000000000a4'), false, 'nobody else''s switches changed');
select * from finish();
rollback;
