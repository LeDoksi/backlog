-- Matches between my list and my friends', and which friends have a given
-- title. Both read friends' shelves only through visible_titles.
create or replace function public.my_friend_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select case when user_a = auth.uid() then user_b else user_a end from friendships where auth.uid() in (user_a, user_b);
$$;

-- Titles we both want or are both in the middle of, by title key. Needs
-- matches switched on by both people.
create or replace function public.matches()
returns table (friend_id uuid, friend_name text, title_key text, title text, category text, cover text, my_status text, friend_status text)
language sql stable security definer set search_path = public as $$
  select f, display_name_of(p), title_key(m.source, m.source_id, m.id), m.title, m.category, m.cover, m.status, th.status
  from my_friend_ids() f
  join profiles p on p.id = f and p.share_matches
  cross join lateral visible_titles(f) th
  join visible_titles(auth.uid()) m on title_key(m.source, m.source_id, m.id) = title_key(th.source, th.source_id, th.id)
  where coalesce((select share_matches from profiles where id = auth.uid()), false)
    and m.status in ('queue', 'unreleased', 'in_progress') and th.status in ('queue', 'unreleased', 'in_progress')
  order by th.updated_at desc
  limit 50;
$$;

-- Friends who have any of these titles, and in what state.
create or replace function public.friends_on_titles(p_keys text[])
returns table (title_key text, friend_id uuid, friend_name text, status text)
language sql stable security definer set search_path = public as $$
  select title_key(th.source, th.source_id, th.id), f, display_name_of(p), th.status
  from my_friend_ids() f
  join profiles p on p.id = f
  cross join lateral visible_titles(f) th
  where title_key(th.source, th.source_id, th.id) = any (p_keys[1:500]);
$$;

do $$
declare f text;
begin
  foreach f in array array['public.matches()', 'public.friends_on_titles(text[])'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'revoke execute on function public.my_friend_ids() from public, anon, authenticated';
  execute 'grant execute on function public.my_friend_ids() to service_role';
end $$;
