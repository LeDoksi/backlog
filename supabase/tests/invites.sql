-- Invite links: only an admin makes them; a link lets one newcomer in and
-- leaves them a friend request from the admin; an expired, spent or revoked
-- link lets nobody in; following the same link again never makes a second
-- request.
begin;
select plan(21);
\ir support/social_fixture.sql
insert into public.admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');

-- Newcomers: not on allowed_emails.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'new1@test', '{"full_name":"Новичок"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'new2@test', '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 'new3@test', '{}');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
create temp table link as select public.create_invite_link() as j;
select ok((select j->>'token' from link) ~ '^[a-z0-9]{10}$', 'token is 10 chars of a-z0-9');
select isnt(public.create_invite_link()->>'token', (select j->>'token' from link), 'every call makes a new link');
select ok((select (j->>'expires_at')::timestamptz between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute' from link), 'link lives 7 days');

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(public.complete_signup((select j->>'token' from link))->>'status', 'created', 'newcomer with a link gets in');
select is(public.complete_signup((select j->>'token' from link))->'invite'->>'status', 'requested', 'following it again is harmless');
select is(public.my_inbox()->'friend_requests'->0->>'name', 'Я', 'request from the link owner waits');
select is(json_array_length(public.my_inbox()->'friend_requests'), 1, 'only one request');
select results_eq($$select kind from public.my_boards()$$, $$values ('personal'::text)$$, 'newcomer has a personal board');
select is(public.my_profile()->>'display_name', null, 'the Google name is not copied');

-- Spent: the second newcomer stays out and is told the link is gone.
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(public.complete_signup((select j->>'token' from link))->>'status', 'not_invited', 'a spent link lets nobody else in');
select is(public.complete_signup((select j->>'token' from link))->'invite'->>'status', 'expired', 'and says why');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(public.redeem_invite((select j->>'token' from link))->>'status', 'expired', 'a spent link is expired for an existing account');

-- Expired.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
create temp table link2 as select public.create_invite_link() as j;
reset role;
update public.invite_links set expires_at = now() - interval '1 second' where token = (select j->>'token' from link2);
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(public.complete_signup((select j->>'token' from link2))->>'status', 'not_invited', 'expired link lets nobody in');
reset role;
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'), 0, 'no profile for the turned-away newcomer');

-- An existing account following a live, unspent link: a request, the link stays unspent.
update public.invite_links set expires_at = now() + interval '7 days' where token = (select j->>'token' from link2);
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(public.redeem_invite((select j->>'token' from link2))->>'status', 'requested', 'existing account gets a request');
select is(public.redeem_invite(upper((select j->>'token' from link2)))->>'status', 'requested', 'case does not matter, still one request');
reset role;
select is((select count(*)::int from public.friend_requests where to_user = '00000000-0000-0000-0000-0000000000a3'), 1, 'no duplicate request');
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(public.redeem_invite((select j->>'token' from link2))->>'status', 'self', 'own link does nothing');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(public.redeem_invite((select j->>'token' from link2))->>'status', 'already_friends', 'a friend is already a friend');
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select is(public.complete_signup((select j->>'token' from link2))->>'status', 'created', 'existing accounts did not spend it');
reset role;
select results_eq($$select user_id::text, outcome from public.invite_redemptions order by user_id, outcome$$,
  $$values ('00000000-0000-0000-0000-0000000000a2'::text, 'already_friends'::text), ('00000000-0000-0000-0000-0000000000a3', 'requested'),
           ('00000000-0000-0000-0000-0000000000c1', 'requested'), ('00000000-0000-0000-0000-0000000000c3', 'requested')$$, 'each follower is recorded once, the owner never');
select * from finish();
rollback;
