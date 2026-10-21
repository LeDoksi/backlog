-- Undo 20261126000000_whats_new.
drop function if exists public.mark_whats_new_seen(timestamptz);

create or replace function public.my_profile() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', id, 'email', email, 'display_name', display_name, 'nickname', nickname, 'theme', theme,
    'in_leaderboard', in_leaderboard, 'share_activity', share_activity, 'share_matches', share_matches,
    'findable_by_nick', findable_by_nick, 'is_admin', is_admin())
  from profiles where id = auth.uid();
$$;

alter table public.profiles drop column if exists whats_new_seen_at;
