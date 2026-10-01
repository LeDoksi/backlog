-- Undo 20261020000600_leaderboard.
drop function if exists public.leaderboard(text, text);
drop function if exists public.safe_timestamptz(text);
