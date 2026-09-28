-- Undo 20261005000000_boards_profiles_titles. Drops the new titles table with
-- its rows: re-run the data migration after re-applying.
alter publication supabase_realtime drop table public.titles;
drop policy if exists "see my boards" on public.workspaces;
drop table if exists public.titles;
drop table if exists public.workspace_members;
drop function if exists public.is_member(uuid);
drop function if exists public.enforce_board_limits();
alter table public.workspaces
  drop constraint if exists workspaces_kind_check,
  drop constraint if exists workspaces_visibility_check,
  drop column if exists kind,
  drop column if exists visibility,
  drop column if exists created_by;
alter table public.profiles
  drop constraint if exists profiles_nickname_key,
  drop constraint if exists profiles_nickname_format,
  drop constraint if exists profiles_theme_check,
  drop column if exists display_name,
  drop column if exists nickname,
  drop column if exists theme,
  drop column if exists in_leaderboard,
  drop column if exists share_activity,
  drop column if exists share_matches,
  drop column if exists findable_by_nick,
  drop column if exists feed_seen_at;
drop extension if exists citext;
