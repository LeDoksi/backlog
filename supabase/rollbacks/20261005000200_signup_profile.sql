-- Undo 20261005000200_signup_profile. Personal boards it created stay (they
-- belong to the boards migration's data).
drop function if exists public.invite_email(text);
drop function if exists public.my_boards();
drop function if exists public.my_profile();
drop function if exists public.set_theme(text);
drop function if exists public.set_profile(text, text);
drop function if exists public.nickname_available(text);
drop function if exists public.complete_signup();
drop table if exists public.board_invites;
