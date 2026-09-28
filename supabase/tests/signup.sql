-- complete_signup gives an invited person a profile, a personal board and its
-- membership; set_profile and the other profile RPCs act on the caller only.
begin;
select plan(16);
create temp table as_user (id uuid) on commit drop;
grant all on as_user to authenticated;

-- An auth.users insert also fires the legacy handle_new_user trigger, which
-- until drop_legacy creates the profile itself: that is the path real
-- sign-ins take, so the tests go through it too.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f0', 'owner@test', '{"full_name":"Owner"}');
insert into public.workspaces (id, kind) values ('10000000-0000-0000-0000-0000000000f0', 'shared');
insert into public.allowed_emails (email, invited_by, workspace_id) values
  ('guest@test', '00000000-0000-0000-0000-0000000000f0', null),
  ('friend@test', '00000000-0000-0000-0000-0000000000f0', '10000000-0000-0000-0000-0000000000f0');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'stranger@test', '{}'),
  ('00000000-0000-0000-0000-00000000000b', 'Guest@test', '{"full_name":"Guest Person"}'),
  ('00000000-0000-0000-0000-00000000000c', 'friend@test', '{"full_name":"Friend"}');
-- A profile the legacy trigger never made (the invite came after sign-up).
delete from public.profiles where id = '00000000-0000-0000-0000-00000000000b';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select is(public.complete_signup()->>'status', 'not_invited', 'stranger is not invited');
reset role;
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-00000000000a'), 0, 'stranger gets no profile');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select is(public.complete_signup()->>'status', 'created', 'invited guest is set up');
select is(public.complete_signup()->>'status', 'exists', 'second call is a no-op');
select results_eq($$select kind, title_count from public.my_boards()$$, $$values ('personal'::text, 0)$$, 'guest has one empty personal board');
select is(public.my_profile()->>'display_name', 'Guest Person', 'display name comes from Google');
reset role;
select is((select count(*)::int from public.workspace_members where user_id = '00000000-0000-0000-0000-00000000000b'), 1, 'one membership');

-- Legacy trigger made the profile (in the inviter's old space); the call
-- still has to give the person their own board and pass the invite on.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select is(public.complete_signup()->>'status', 'created', 'profile made by the old trigger still gets a board');
select results_eq($$select kind from public.my_boards()$$, $$values ('personal'::text)$$, 'friend has a personal board');
reset role;
select is((select count(*)::int from public.board_invites where to_user = '00000000-0000-0000-0000-00000000000c' and workspace_id = '10000000-0000-0000-0000-0000000000f0'), 1, 'invite into the shared board is waiting');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select lives_ok($$select public.set_profile('Гость', 'ABC_1')$$, 'set_profile accepts a nickname');
select is(public.my_profile()->>'nickname', 'abc_1', 'nickname is stored lower-case');
select is(public.nickname_available('abc_1'), true, 'own nickname counts as available');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select is(public.nickname_available('ABC_1'), false, 'taken nickname is not available');
select throws_like($$select public.set_profile('F', 'abc_1')$$, 'nickname_taken', 'taken nickname is rejected');
select throws_like($$select public.set_profile('F', 'no spaces')$$, 'nickname_format', 'bad nickname is rejected');
select * from finish();
rollback;
