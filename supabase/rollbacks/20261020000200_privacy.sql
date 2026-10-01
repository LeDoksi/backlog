-- Undo 20261020000200_privacy.
drop function if exists public.my_hidden_titles();
drop function if exists public.set_privacy(boolean, boolean, boolean, boolean);
drop function if exists public.set_board_visibility(uuid, text);
