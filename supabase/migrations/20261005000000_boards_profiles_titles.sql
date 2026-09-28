-- Boards (personal and shared), membership, profile identity fields and the
-- one `titles` table that replaces drafts + overrides + parts. Additive: the
-- old tables stay until the drop_legacy migration.
create extension if not exists citext;

-- Profiles gain identity and privacy settings; workspace_id stays until B10
-- because the C client still reads it through current_workspace_id().
alter table public.profiles
  add column if not exists display_name text,
  add column if not exists nickname citext,
  add column if not exists theme text not null default 'system',
  add column if not exists in_leaderboard boolean not null default false,
  add column if not exists share_activity boolean not null default true,
  add column if not exists share_matches boolean not null default true,
  add column if not exists findable_by_nick boolean not null default true,
  add column if not exists feed_seen_at timestamptz;
alter table public.profiles add constraint profiles_nickname_key unique (nickname);
alter table public.profiles add constraint profiles_nickname_format check (nickname is null or nickname::text ~ '^[a-z0-9_]{3,20}$');
alter table public.profiles add constraint profiles_theme_check check (theme in ('system', 'light', 'dark'));

alter table public.workspaces
  add column if not exists kind text not null default 'personal',
  add column if not exists visibility text not null default 'private',
  add column if not exists created_by uuid references auth.users(id);
alter table public.workspaces add constraint workspaces_kind_check check (kind in ('personal', 'shared'));
alter table public.workspaces add constraint workspaces_visibility_check check (visibility in ('private', 'friends', 'everyone'));

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

create or replace function public.enforce_board_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  select kind into k from workspaces where id = new.workspace_id;
  if exists (
    select 1 from workspace_members m join workspaces w on w.id = m.workspace_id
    where m.user_id = new.user_id and w.kind = k and m.workspace_id <> new.workspace_id
  ) then
    raise exception 'board_limit: already has a % board', k using errcode = 'P0001';
  end if;
  if k = 'personal' and exists (select 1 from workspace_members where workspace_id = new.workspace_id and user_id <> new.user_id) then
    raise exception 'board_limit: personal board has a single member' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger workspace_members_limits before insert on public.workspace_members
  for each row execute function public.enforce_board_limits();

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid());
$$;

create table public.titles (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  title text not null,
  original_title text,
  category text not null check (category in ('game', 'series', 'movie', 'anime')),
  status text not null default 'queue' check (status in ('queue', 'in_progress', 'done', 'unreleased')),
  manual_status text check (manual_status in ('queue', 'in_progress', 'done', 'unreleased')),
  airing_status text check (airing_status in ('ongoing', 'completed')),
  year int,
  genres jsonb not null default '[]'::jsonb,
  synopsis text not null default '',
  cover text,
  season_info text,
  platforms jsonb,
  parts jsonb,
  checked_parts jsonb not null default '{}'::jsonb,
  source text,
  source_id text,
  hidden boolean not null default false,
  rating int,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index titles_source_idx on public.titles (source, source_id);
create index titles_completed_idx on public.titles (completed_at) where completed_at is not null;

alter table public.titles enable row level security;
create policy "members read titles" on public.titles for select using (public.is_member(workspace_id));
create policy "members insert titles" on public.titles for insert with check (public.is_member(workspace_id));
create policy "members update titles" on public.titles for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "members delete titles" on public.titles for delete using (public.is_member(workspace_id));

alter table public.workspace_members enable row level security;
create policy "see members of my boards" on public.workspace_members for select using (public.is_member(workspace_id));

create policy "see my boards" on public.workspaces for select using (public.is_member(id));

alter publication supabase_realtime add table public.titles;

revoke execute on function public.is_member(uuid) from anon;
