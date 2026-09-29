-- Undo 20261020000300_activity_feed. Events already written stay in
-- activity_events (dropped with the table by the social_core rollback).
drop function if exists public.badge_count();
drop function if exists public.mark_feed_seen();
drop function if exists public.feed(timestamptz, int, text);
drop trigger if exists titles_activity on public.titles;
drop function if exists public.titles_activity();
