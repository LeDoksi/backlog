-- Undo 20261205000000_other_items.
drop function if exists public.delete_other_item(uuid, uuid);
drop function if exists public.save_other_item(uuid, jsonb);
drop function if exists public.other_items(uuid);
drop function if exists public.other_item_json(public.other_items);
drop function if exists public.set_show_other(boolean);

create or replace function public.my_profile() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', id, 'email', email, 'display_name', display_name, 'nickname', nickname, 'theme', theme,
    'in_leaderboard', in_leaderboard, 'share_activity', share_activity, 'share_matches', share_matches,
    'findable_by_nick', findable_by_nick, 'is_admin', is_admin(), 'whats_new_seen_at', whats_new_seen_at)
  from profiles where id = auth.uid();
$$;

alter table public.profiles drop column if exists show_other;
drop table if exists public.other_items;
