-- «Что нового» in the profile (BL-116). The entries live in the app
-- (app/src/data/whatsNew.ts); the database only keeps, per person, the date
-- of the newest entry they have opened, so the dot goes out on every device.
-- People already here start with null and see the first entry as new; a
-- profile made from now on starts at the moment of sign-up, so nobody
-- invited later sees a dot for entries from before they came.
alter table public.profiles add column whats_new_seen_at timestamptz;
alter table public.profiles alter column whats_new_seen_at set default now();

create or replace function public.my_profile() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', id, 'email', email, 'display_name', display_name, 'nickname', nickname, 'theme', theme,
    'in_leaderboard', in_leaderboard, 'share_activity', share_activity, 'share_matches', share_matches,
    'findable_by_nick', findable_by_nick, 'is_admin', is_admin(), 'whats_new_seen_at', whats_new_seen_at)
  from profiles where id = auth.uid();
$$;

-- p_at is the date of the newest entry the person saw. The mark only moves
-- forward (an old copy of the app cannot light the dot again) and never
-- past now (a wrong date cannot hide entries that are yet to come).
create function public.mark_whats_new_seen(p_at timestamptz) returns void
language sql security definer set search_path = public as $$
  update profiles set whats_new_seen_at = greatest(whats_new_seen_at, least(p_at, now()))
  where id = auth.uid() and p_at is not null;
$$;

revoke execute on function public.mark_whats_new_seen(timestamptz) from public, anon;
grant execute on function public.mark_whats_new_seen(timestamptz) to authenticated, service_role;
