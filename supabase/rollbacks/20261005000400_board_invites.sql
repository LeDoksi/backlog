-- Undo 20261005000400_board_invites. The board_invites table belongs to
-- signup_profile and stays.
drop function if exists public.copy_title(text, uuid, uuid);
drop function if exists public.remove_board_member(uuid);
drop function if exists public.leave_shared_board();
drop function if exists public.respond_board_invite(bigint, boolean);
drop function if exists public.my_board_invites();
drop function if exists public.invite_to_shared_board(uuid);
drop function if exists public.find_user_by_nick(text);
