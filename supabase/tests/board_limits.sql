-- One personal board and at most one shared board per person, enforced in a
-- trigger so that two invites racing each other cannot break it.
begin;
select plan(5);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test');
insert into public.workspaces (id, kind) values
  ('10000000-0000-0000-0000-000000000001', 'personal'),
  ('10000000-0000-0000-0000-000000000002', 'personal'),
  ('10000000-0000-0000-0000-000000000003', 'shared'),
  ('10000000-0000-0000-0000-000000000004', 'shared');
insert into public.workspace_members (workspace_id, user_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a');
select throws_like(
  $$insert into public.workspace_members (workspace_id, user_id) values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a')$$,
  'board_limit%', 'second personal board is rejected');
select throws_like(
  $$insert into public.workspace_members (workspace_id, user_id) values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b')$$,
  'board_limit%', 'personal board takes a single member');
insert into public.workspace_members (workspace_id, user_id) values
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a');
select lives_ok(
  $$insert into public.workspace_members (workspace_id, user_id) values ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000b')$$,
  'shared board takes a second member');
select throws_like(
  $$insert into public.workspace_members (workspace_id, user_id) values ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000a')$$,
  'board_limit%', 'second shared board is rejected');
select throws_like(
  $$set local role authenticated; set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
    insert into public.workspace_members (workspace_id, user_id) values ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-00000000000c')$$,
  '%row-level security%', 'members cannot be written directly');
select * from finish();
rollback;
