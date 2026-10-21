-- Closed club: only an admin invites, nobody writes invites into the tables
-- directly, links can be bound to an email and revoked, board mates do not
-- see each other's email, and a person can delete their own account
-- without taking anyone else's data with them.
begin;
select plan(67);
\ir support/social_fixture.sql
insert into public.admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'Pal@test', '{"full_name":"Pal From Google"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'bound@test', '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 'wrong@test', '{}');

-- Who may call what.
select ok(not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'), f || ' is for signed-in people')
from unnest(array['public.is_admin()', 'public.create_invite_link(text)', 'public.admin_invites()', 'public.admin_revoke_invite(text,text)', 'public.delete_my_account(text)']) f;
select ok(not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'), f || ' is not an RPC')
from unnest(array['public.assert_admin()', 'public.delete_stray_auth_users()']) f;
select ok(not has_table_privilege('authenticated', t, p), t || ' has no direct ' || p)
from unnest(array['public.allowed_emails', 'public.invite_links', 'public.admins']) t, unnest(array['select', 'insert', 'update', 'delete']) p;
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('allowed_emails', 'admins')), 0, 'no policies open invites or admins');

-- A stranger's Google sign-in cannot let itself in.
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select throws_ok($$select public.invite_email('wrong@test')$$, '42501', 'not_admin', 'a stranger cannot invite themselves');
select throws_ok($$insert into public.allowed_emails (email, invited_by) values ('wrong@test', '00000000-0000-0000-0000-0000000000c3')$$, '42501', null, 'nor write the invite directly');
select is(public.complete_signup()->>'status', 'not_invited', 'and stays out');

-- A member keeps friends but cannot widen the circle.
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is(public.is_admin(), false, 'a member is not an admin');
select is(public.my_profile()->>'is_admin', 'false', 'the profile says so');
select throws_ok($$select public.invite_email('pal@test')$$, '42501', 'not_admin', 'a member cannot invite by email');
select throws_ok($$select public.create_invite_link()$$, '42501', 'not_admin', 'a member cannot make a link');
select throws_ok($$select public.admin_invites()$$, '42501', 'not_admin', 'a member cannot list invites');
select throws_ok($$select public.admin_revoke_invite('link', 'x')$$, '42501', 'not_admin', 'a member cannot revoke');
select is(public.send_friend_request('00000000-0000-0000-0000-0000000000a3')->>'status', 'requested', 'a member still sends friend requests');

-- The admin invites by email; the newcomer gets in without the Google name.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(public.my_profile()->>'is_admin', 'true', 'the admin is told so');
select throws_ok($$select public.invite_email('not an email')$$, 'P0001', 'bad_email', 'a bad address is refused');
select lives_ok($$select public.invite_email(' PAL@test ')$$, 'the admin invites by email');
select is(public.admin_invites()->'emails'->0->>'email', 'pal@test', 'the invite is listed');
select ok((public.admin_invites()->'emails'->0->>'expires_at')::timestamptz > now() + interval '29 days', 'it lives 30 days');
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select is(public.complete_signup()->>'status', 'created', 'the invited person gets in');
select is(public.my_profile()->>'display_name', null, 'with no name taken from Google');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(json_array_length(public.admin_invites()->'emails'), 0, 'a used invite leaves the list');

-- A link bound to an email lets only that account in; a revoked one nobody.
create temp table bound as select public.create_invite_link('Bound@test') as j;
select is((select j->>'email' from bound), 'bound@test', 'the link remembers the email');
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select is(public.complete_signup((select j->>'token' from bound))->>'status', 'not_invited', 'another account cannot use it');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(public.redeem_invite((select j->>'token' from bound))->>'status', 'expired', 'nor can a member it was forwarded to');
select pg_temp.login('00000000-0000-0000-0000-0000000000c2');
select is(public.complete_signup((select j->>'token' from bound))->>'status', 'created', 'the named account can');
reset role;
-- A second, overlapping check from the same sign-in reads «no profile yet»
-- before the first one commits; it may claim the link again (and then
-- stops at the profile) instead of answering «not invited».
delete from public.workspaces w using public.workspace_members m where m.workspace_id = w.id and m.user_id = '00000000-0000-0000-0000-0000000000c2';
delete from public.profiles where id = '00000000-0000-0000-0000-0000000000c2';
set local role authenticated;
select is(public.complete_signup((select j->>'token' from bound))->>'status', 'created', 'the same person may claim their own link again');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
create temp table loose as select public.create_invite_link() as j;
select is(json_array_length(public.admin_invites()->'links'), 1, 'only the unspent link is listed');
select lives_ok($$select public.admin_revoke_invite('link', (select j->>'token' from loose))$$, 'the admin revokes it');
select is(json_array_length(public.admin_invites()->'links'), 0, 'and it leaves the list');
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select is(public.complete_signup((select j->>'token' from loose))->>'status', 'not_invited', 'a revoked link lets nobody in');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.invite_email('wrong@test')$$, 'invite by email');
select lives_ok($$select public.admin_revoke_invite('email', 'WRONG@test')$$, 'and take it back');
select pg_temp.login('00000000-0000-0000-0000-0000000000c3');
select is(public.complete_signup()->>'status', 'not_invited', 'a revoked email invite lets nobody in');

-- Board mates see names, not addresses, nor the first half of one.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.my_boards() b, json_array_elements(b.members) m where m->>'email' is not null), 0, 'no email in board members');
select is((select name from public.find_user_by_nick('stranger')), 'stranger', 'someone without a name shows by nickname, not by email');

-- Re-inviting a pending v1 board invite drops the board.
reset role;
insert into public.allowed_emails (email, invited_by, workspace_id) values ('old@test', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b5');
set local role authenticated;
select lives_ok($$select public.invite_email('old@test')$$, 're-invite a pending address');
reset role;
select results_eq($$select invited_by, workspace_id from public.allowed_emails where email = 'old@test'$$,
  $$values ('00000000-0000-0000-0000-0000000000a1'::uuid, null::uuid)$$, 'the invite is the admin''s now, without the old board');
set local role authenticated;

-- Deleting an account. The mate (a4) shares board b5 with me and has a
-- title there, a personal board with a title, a friend and an event.
reset role;
select pg_temp.put('00000000-0000-0000-0000-0000000000b4', 'mates-own');
select pg_temp.put('00000000-0000-0000-0000-0000000000b5', 'on-shared');
update public.titles set created_by = '00000000-0000-0000-0000-0000000000a4' where id = 'on-shared';
insert into public.friendships (user_a, user_b) values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a4');
insert into public.allowed_emails (email, invited_by) values ('mate@test', '00000000-0000-0000-0000-0000000000a1'), ('invited-by-mate@test', '00000000-0000-0000-0000-0000000000a4');
insert into public.invite_links (token, created_by, expires_at, email, used_by, used_at)
values ('matelink01', '00000000-0000-0000-0000-0000000000a1', now() + interval '1 day', 'mate@test', '00000000-0000-0000-0000-0000000000a4', now());
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is(public.delete_my_account('someone_else')->>'status', 'wrong_nickname', 'the wrong nickname deletes nothing');
select is(public.delete_my_account(null)->>'status', 'wrong_nickname', 'no nickname deletes nothing');
select is(public.delete_my_account('@Mate_User')->>'status', 'deleted', 'the right nickname deletes the account');
reset role;
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-0000000000a4'), 0, 'the auth user is gone');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000a4')
        + (select count(*)::int from public.friendships where '00000000-0000-0000-0000-0000000000a4' in (user_a, user_b))
        + (select count(*)::int from public.workspace_members where user_id = '00000000-0000-0000-0000-0000000000a4'), 0, 'profile, friendships and memberships are gone');
select is((select count(*)::int from public.workspaces where id = '00000000-0000-0000-0000-0000000000b4')
        + (select count(*)::int from public.titles where workspace_id = '00000000-0000-0000-0000-0000000000b4'), 0, 'the personal board and its titles are gone');
select results_eq($$select id, created_by from public.titles where workspace_id = '00000000-0000-0000-0000-0000000000b5'$$,
  $$values ('on-shared'::text, null::uuid)$$, 'the shared board keeps the title, without the author');
select is((select count(*)::int from public.workspace_members where workspace_id = '00000000-0000-0000-0000-0000000000b5'), 1, 'the shared board stays with the other member');
select results_eq($$select email, invited_by from public.allowed_emails where email in ('mate@test', 'invited-by-mate@test')$$,
  $$values ('invited-by-mate@test'::text, null::uuid)$$, 'their own invite is gone, the ones they made forget them');
select results_eq($$select email, used_by, used_at is not null from public.invite_links where token = 'matelink01'$$,
  $$values (null::text, null::uuid, true)$$, 'the link they used forgets their address and stays spent');

-- The last admin cannot delete themselves by accident.
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(public.delete_my_account('me_user')->>'status', 'last_admin', 'the last admin is kept');

-- Stray Google sign-ins without a profile are cleaned up after a day.
reset role;
insert into auth.users (id, email, created_at) values
  ('00000000-0000-0000-0000-0000000000d1', 'old-stray@test', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000000d2', 'new-stray@test', now() - interval '1 hour');
update auth.users set created_at = now() - interval '2 days' where id = '00000000-0000-0000-0000-0000000000a2';
select is(public.delete_stray_auth_users(), 1, 'an old stray is removed');
select results_eq($$select id::text from auth.users where id in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2') order by id$$,
  $$values ('00000000-0000-0000-0000-0000000000a2'::text), ('00000000-0000-0000-0000-0000000000d2')$$, 'members and fresh sign-ins stay');
select * from finish();
rollback;
