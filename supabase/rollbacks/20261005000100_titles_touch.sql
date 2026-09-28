-- Undo 20261005000100_titles_touch.
drop trigger if exists titles_touch on public.titles;
drop function if exists public.titles_touch();
