-- Social tables and the one helper that decides what of someone's shelf a
-- viewer may see. Friendships and requests are readable by the two people
-- involved; invite links and activity events have no policies at all and
-- are reached only through security-definer RPCs.
create table public.friendships (
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_user_b_idx on public.friendships (user_b);

create table public.friend_requests (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_user, to_user),
  check (from_user <> to_user)
);
create index friend_requests_to_idx on public.friend_requests (to_user);

create table public.invite_links (
  token text primary key,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index invite_links_owner_idx on public.invite_links (created_by, created_at desc);

create table public.activity_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title_id text not null,
  kind text not null check (kind in ('added', 'started', 'completed', 'parts')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_events_actor_time_idx on public.activity_events (actor_id, created_at desc);
create index activity_events_time_idx on public.activity_events (created_at);

alter table public.friendships enable row level security;
alter table public.friend_requests enable row level security;
alter table public.invite_links enable row level security;
alter table public.activity_events enable row level security;
create policy "see my friendships" on public.friendships for select using (auth.uid() in (user_a, user_b));
create policy "see my requests" on public.friend_requests for select using (auth.uid() in (from_user, to_user));

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships where user_a = least(a, b) and user_b = greatest(a, b));
$$;

-- Social features compare titles across boards and people by this key, not
-- by the board-local slug id.
create or replace function public.title_key(p_source text, p_source_id text, p_id text) returns text
language sql immutable as $$
  select coalesce(p_source || ':' || p_source_id, 'slug:' || p_id);
$$;

-- The one place privacy is decided; every social read goes through it.
-- What of p_owner's shelf p_viewer may see: all of it to the owner and to
-- members of a board (hidden titles included); to anyone else the titles
-- not hidden on boards opened to them. A title on both of the owner's
-- boards comes back once, preferring the personal copy.
create or replace function public.visible_titles_for(p_owner uuid, p_viewer uuid) returns setof public.titles
language sql stable security definer set search_path = public as $$
  select distinct on (title_key(t.source, t.source_id, t.id)) t.*
  from titles t
  join workspace_members m on m.workspace_id = t.workspace_id and m.user_id = p_owner
  join workspaces w on w.id = t.workspace_id
  where p_viewer is not null and (
    p_owner = p_viewer
    or exists (select 1 from workspace_members v where v.workspace_id = t.workspace_id and v.user_id = p_viewer)
    or (not t.hidden and (w.visibility = 'everyone' or (w.visibility = 'friends' and are_friends(p_owner, p_viewer))))
  )
  order by title_key(t.source, t.source_id, t.id), (w.kind = 'shared');
$$;

-- The same, seen by the caller.
create or replace function public.visible_titles(p_owner uuid) returns setof public.titles
language sql stable security definer set search_path = public as $$
  select * from visible_titles_for(p_owner, auth.uid());
$$;

-- Someone who was let into the app has a personal board. A Google sign-in
-- that got «не приглашён» has a session but no board, and social RPCs
-- treat such a caller as nobody.
create or replace function public.is_app_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members m join workspaces w on w.id = m.workspace_id
                 where m.user_id = p_user and w.kind = 'personal');
$$;

-- A board both people are on: its titles are one row with one status, so
-- they say nothing about how two people's tastes compare.
create or replace function public.on_common_board(p_workspace uuid, a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members x join workspace_members y on y.workspace_id = x.workspace_id
                 where x.workspace_id = p_workspace and x.user_id = a and y.user_id = b);
$$;

create or replace function public.display_name_of(p public.profiles) returns text
language sql stable as $$
  select coalesce(nullif(trim(p.display_name), ''), p.nickname::text, 'Без имени');
$$;

-- Helpers are building blocks for the RPCs, not RPCs themselves:
-- are_friends(a, b) would let anyone probe who is friends with whom.
do $$
declare f text;
begin
  foreach f in array array['public.are_friends(uuid,uuid)', 'public.visible_titles_for(uuid,uuid)', 'public.visible_titles(uuid)',
                           'public.display_name_of(public.profiles)', 'public.is_app_user(uuid)',
                           'public.on_common_board(uuid,uuid,uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Events older than 90 days are dropped nightly. pg_cron exists on
-- Supabase but not on a plain local Postgres (the pgTAP runner), so the job
-- is scheduled only where the extension is available.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('bl-activity-retention', '17 3 * * *',
      $job$delete from public.activity_events where created_at < now() - interval '90 days'$job$);
  end if;
end $$;
