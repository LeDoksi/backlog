-- Review fixes: someone who signed in with Google but was never let in
-- (no profile, no board) cannot mint a link to let themselves in, cannot
-- search people or send requests, and cannot light up anyone's badge.
begin;
select plan(7);
\ir support/social_fixture.sql
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000c9', 'outsider@test', '{}');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c9');
select throws_ok($$select public.create_invite_link()$$, 'P0001', 'not_invited', 'an outsider cannot mint a link');
reset role;
-- Even a link planted in the table in their name does not open the door.
insert into public.invite_links (token, created_by, expires_at) values ('selfmade01', '00000000-0000-0000-0000-0000000000c9', now() + interval '7 days');
set local role authenticated;
select is(public.complete_signup('selfmade01')->>'status', 'not_invited', 'a self-made link lets nobody in');
select is((select count(*)::int from public.search_users('me_')), 0, 'an outsider finds nobody');
select throws_ok($$select public.send_friend_request('00000000-0000-0000-0000-0000000000a1')$$, 'P0001', 'not_invited', 'an outsider cannot send requests');
reset role;
insert into public.friend_requests (from_user, to_user) values ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(public.badge_count(), 0, 'a request from someone without a profile does not count');
select is(json_array_length(public.my_inbox()->'friend_requests'), 0, 'and is not listed');
-- A member's own link still works for a newcomer (invites.sql covers the rest).
select ok((public.create_invite_link()->>'token') is not null, 'members still get links');
select * from finish();
rollback;
