-- Joining a shared board takes an accepted invite; copying a title carries
-- metadata, never progress.
begin;
select plan(17);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test');
insert into public.allowed_emails (email) values ('a@test'), ('b@test'), ('c@test'), ('d@test');
-- Profiles came from the legacy trigger; give each a personal board.
do $$ declare u uuid; begin
  foreach u in array array['00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
                           '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d']::uuid[] loop
    perform set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    perform public.complete_signup();
  end loop;
end $$;
update public.profiles set nickname = 'bob' where id = '00000000-0000-0000-0000-00000000000b';
update public.profiles set nickname = 'dan', findable_by_nick = false where id = '00000000-0000-0000-0000-00000000000d';

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select results_eq($$select nickname from public.find_user_by_nick('BOB')$$, $$values ('bob')$$, 'finds a user by exact nickname');
select is_empty($$select 1 from public.find_user_by_nick('dan')$$, 'hidden user is not found');
select throws_like($$select public.invite_to_shared_board('00000000-0000-0000-0000-00000000000a')$$, 'cannot_invite_self', 'cannot invite yourself');
select lives_ok($$select public.invite_to_shared_board('00000000-0000-0000-0000-00000000000b')$$, 'invite without a shared board');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select is((select count(*)::int from public.my_board_invites()), 1, 'invitee sees the invite');
select is((select count(*)::int from public.my_boards() where kind = 'shared'), 0, 'not a member before accepting');
select lives_ok($$select public.respond_board_invite((select id from public.my_board_invites()), true)$$, 'accepts');
select results_eq($$select json_array_length(members) from public.my_boards() where kind = 'shared'$$, $$values (2)$$, 'accepting creates the shared board with both');

-- c declines
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select lives_ok($$select public.invite_to_shared_board('00000000-0000-0000-0000-00000000000c')$$, 'invite into the existing shared board');
select throws_like($$select public.invite_to_shared_board('00000000-0000-0000-0000-00000000000b')$$, 'already_member', 'member cannot be invited again');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select lives_ok($$select public.respond_board_invite((select id from public.my_board_invites()), false)$$, 'declines');
select is((select count(*)::int from public.my_board_invites()), 0, 'declined invite is gone');
select is((select count(*)::int from public.my_boards() where kind = 'shared'), 0, 'declining joins nothing');

-- c makes their own shared board with d; a cannot pull c in then
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.invite_to_shared_board('00000000-0000-0000-0000-00000000000d');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000d"}';
select public.respond_board_invite((select id from public.my_board_invites()), true);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select throws_like($$select public.invite_to_shared_board('00000000-0000-0000-0000-00000000000c')$$, 'target_has_shared', 'someone with another shared board cannot be invited');

-- c cannot remove b from a's board
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.remove_board_member('00000000-0000-0000-0000-00000000000b');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b"}';
select is((select count(*)::int from public.my_boards() where kind = 'shared'), 1, 'remove_board_member does nothing outside own board');

-- copy
reset role;
insert into public.titles (workspace_id, id, title, category, status, checked_parts, parts, source, source_id)
select m.workspace_id, 'show-2020', 'Show', 'series', 'in_progress', '{"0":"2026-01-01"}', '[{"name":"S1","released":true},{"name":"S2","released":true}]', 'tmdb-tv', '42'
from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
where m.user_id = '00000000-0000-0000-0000-00000000000a' and w.kind = 'personal';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.copy_title('show-2020',
  (select id from public.my_boards() where kind = 'personal'), (select id from public.my_boards() where kind = 'shared'));
select results_eq(
  $$select status, checked_parts::text, source_id from public.titles t join public.workspaces w on w.id = t.workspace_id where w.kind = 'shared'$$,
  $$values ('queue'::text, '{}'::text, '42'::text)$$, 'copy starts from the queue with no progress');
select throws_like($$select public.copy_title('show-2020',
  (select id from public.my_boards() where kind = 'personal'), (select id from public.my_boards() where kind = 'shared'))$$,
  'duplicate', 'second copy is a duplicate');
select * from finish();
rollback;
