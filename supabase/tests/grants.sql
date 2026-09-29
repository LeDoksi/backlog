-- Signed-out visitors cannot call any v2 RPC; trigger functions are not RPCs.
begin;
select plan(18);
select ok(not has_function_privilege('anon', f, 'execute'), f || ' is closed to anon')
from unnest(array[
  'public.complete_signup(text)', 'public.nickname_available(text)', 'public.set_profile(text,text)',
  'public.set_theme(text)', 'public.my_profile()', 'public.my_boards()', 'public.invite_email(text)',
  'public.find_user_by_nick(text)', 'public.invite_to_shared_board(uuid)', 'public.my_board_invites()',
  'public.respond_board_invite(bigint,boolean)', 'public.leave_shared_board()', 'public.remove_board_member(uuid)',
  'public.copy_title(text,uuid,uuid)', 'public.is_member(uuid)']) f;
select ok(has_function_privilege('authenticated', 'public.complete_signup(text)', 'execute'), 'signed-in users can complete sign-up');
select ok(not has_function_privilege('authenticated', 'public.enforce_board_limits()', 'execute'), 'trigger function is not callable');
select ok(not has_function_privilege('authenticated', 'public.titles_touch()', 'execute'), 'titles_touch is not callable');
select * from finish();
rollback;
