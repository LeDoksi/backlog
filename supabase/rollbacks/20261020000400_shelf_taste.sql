-- Undo 20261020000400_shelf_taste.
drop function if exists public.taste_match(uuid);
drop function if exists public.friend_shelf(uuid, text);
drop function if exists public.friend_profile(uuid);
