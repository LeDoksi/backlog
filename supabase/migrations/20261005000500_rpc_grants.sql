-- Functions are executable by PUBLIC by default, so the per-function
-- `revoke … from anon` in the earlier B migrations had no effect: anon still
-- held the grant through PUBLIC. RPCs are for signed-in users only, and the
-- trigger functions are not RPCs at all.
do $$
declare f text;
begin
  foreach f in array array[
    'public.complete_signup()', 'public.nickname_available(text)', 'public.set_profile(text,text)',
    'public.set_theme(text)', 'public.my_profile()', 'public.my_boards()', 'public.invite_email(text)',
    'public.find_user_by_nick(text)', 'public.invite_to_shared_board(uuid)', 'public.my_board_invites()',
    'public.respond_board_invite(bigint,boolean)', 'public.leave_shared_board()', 'public.remove_board_member(uuid)',
    'public.copy_title(text,uuid,uuid)', 'public.is_member(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.enforce_board_limits()', 'public.titles_touch()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;
alter function public.titles_touch() set search_path = public;
