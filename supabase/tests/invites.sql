-- Invite links: a valid token lets a new person in and leaves them a
-- friend request from the link's owner; an expired one lets nobody in;
-- following the same link again never makes a second request.
begin;
select plan(19);
\ir support/social_fixture.sql

-- Newcomers: not on allowed_emails, so the legacy trigger made no profile.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'new1@test', '{"full_name":"Новичок"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'new2@test', '{}');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
create temp table link as select public.create_invite_link() as j;
select ok((select j->>'token' from link) ~ '^[a-z0-9]{10}$', 'token is 10 chars of a-z0-9');
select is(public.create_invite_link()->>'token', (select j->>'token' from link), 'a fresh link is handed out again');
select ok((select (j->>'expires_at')::timestamptz between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute' from link), 'link lives 7 days');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(public.complete_signup((select j->>'token' from link))->>'status', 'created', 'newcomer with a link gets in');
select is(public.complete_signup((select j->>'token' from link))->'invite'->>'status', 'requested', 'following it again is harmless');
select is(public.my_inbox()->'friend_requests'->0->>'name', 'Я', 'request from the link owner waits');
select is(json_array_length(public.my_inbox()->'friend_requests'), 1, 'only one request');
select results_eq($$select kind from public.my_boards()$$, $$values ('personal'::text)$$, 'newcomer has a personal board');

-- Expired link: a newcomer stays out, an existing account is told.
reset role;
update public.invite_links set expires_at = now() - interval '1 second';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(public.complete_signup((select j->>'token' from link))->>'status', 'not_invited', 'expired link lets nobody in');
select is(public.complete_signup((select j->>'token' from link))->'invite'->>'status', 'expired', 'and says why');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(public.redeem_invite((select j->>'token' from link))->>'status', 'expired', 'expired for an existing account');
reset role;
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'), 0, 'no profile for the expired newcomer');

-- An existing account following a live link.
update public.invite_links set expires_at = now() + interval '7 days';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(public.redeem_invite((select j->>'token' from link))->>'status', 'requested', 'existing account gets a request');
select is(public.redeem_invite(upper((select j->>'token' from link)))->>'status', 'requested', 'case does not matter, still one request');
reset role;
select is((select count(*)::int from public.friend_requests where to_user = '00000000-0000-0000-0000-0000000000a3'), 1, 'no duplicate request');
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(public.redeem_invite((select j->>'token' from link))->>'status', 'self', 'own link does nothing');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(public.redeem_invite((select j->>'token' from link))->>'status', 'already_friends', 'a friend is already a friend');
reset role;
select results_eq($$select user_id::text, outcome from public.invite_redemptions order by user_id$$,
  $$values ('00000000-0000-0000-0000-0000000000a2'::text, 'already_friends'::text), ('00000000-0000-0000-0000-0000000000a3', 'requested'),
           ('00000000-0000-0000-0000-0000000000c1', 'requested')$$, 'each follower is recorded once, the owner never');
select is((select count(*)::int from public.invite_redemptions r join public.invite_links l using (token)), 3, 'recorded against the link');
select * from finish();
rollback;
