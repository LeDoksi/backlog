-- Undo 20261005000500_rpc_grants: back to PUBLIC execute (Postgres default).
do $$
declare f text;
begin
  foreach f in array array[
    'public.complete_signup()', 'public.nickname_available(text)', 'public.set_profile(text,text)',
    'public.set_theme(text)', 'public.my_profile()', 'public.my_boards()', 'public.invite_email(text)',
    'public.find_user_by_nick(text)', 'public.invite_to_shared_board(uuid)', 'public.my_board_invites()',
    'public.respond_board_invite(bigint,boolean)', 'public.leave_shared_board()', 'public.remove_board_member(uuid)',
    'public.copy_title(text,uuid,uuid)', 'public.is_member(uuid)',
    'public.enforce_board_limits()', 'public.titles_touch()'
  ] loop
    execute format('grant execute on function %s to public', f);
  end loop;
end $$;
alter function public.titles_touch() reset search_path;
