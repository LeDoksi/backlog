-- Sign-up, profile and "my boards" RPCs. board_invites comes first because
-- complete_signup writes to it; the invite RPCs themselves are in the
-- board_invites migration, whose `create table if not exists` is a no-op
-- after this one.
create table if not exists public.board_invites (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_user, to_user)
);
alter table public.board_invites enable row level security;
create policy "see own board invites" on public.board_invites for select using (to_user = auth.uid() or from_user = auth.uid());

-- Idempotent: sets up whatever of profile, personal board and membership is
-- missing. Until drop_legacy the old handle_new_user trigger still creates the
-- profile at sign-in (into the inviter's old space), so the usual path here is
-- "profile exists, no board yet"; that still counts as 'created'.
create or replace function public.complete_signup() returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  em text;
  full_name text;
  allowed record;
  ws uuid;
  had_profile boolean;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  had_profile := exists (select 1 from profiles where id = uid);
  if had_profile and exists (
    select 1 from workspace_members m join workspaces w on w.id = m.workspace_id
    where m.user_id = uid and w.kind = 'personal'
  ) then
    return json_build_object('status', 'exists');
  end if;
  select u.email, u.raw_user_meta_data->>'full_name' into em, full_name from auth.users u where u.id = uid;
  select * into allowed from allowed_emails a where lower(a.email) = lower(trim(em));
  if not had_profile and allowed is null then return json_build_object('status', 'not_invited'); end if;
  insert into workspaces (kind, created_by) values ('personal', uid) returning id into ws;
  if had_profile then
    update profiles set display_name = coalesce(display_name, nullif(trim(full_name), '')) where id = uid;
  else
    insert into profiles (id, email, workspace_id, display_name) values (uid, lower(trim(em)), ws, nullif(trim(full_name), ''));
  end if;
  insert into workspace_members (workspace_id, user_id) values (ws, uid);
  if allowed is not null and allowed.workspace_id is not null
     and exists (select 1 from workspaces where id = allowed.workspace_id and kind = 'shared') then
    insert into board_invites (workspace_id, from_user, to_user)
    values (allowed.workspace_id, coalesce(allowed.invited_by, uid), uid)
    on conflict (from_user, to_user) do nothing;
  end if;
  return json_build_object('status', 'created');
end $$;

create or replace function public.nickname_available(p_nickname text) returns boolean
language sql stable security definer set search_path = public as $$
  select lower(p_nickname) ~ '^[a-z0-9_]{3,20}$'
     and not exists (select 1 from profiles where nickname = lower(p_nickname) and id <> auth.uid());
$$;

create or replace function public.set_profile(p_display_name text, p_nickname text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if coalesce(lower(p_nickname), '') !~ '^[a-z0-9_]{3,20}$' then raise exception 'nickname_format' using errcode = 'P0001'; end if;
  update profiles set display_name = nullif(trim(p_display_name), ''), nickname = lower(p_nickname) where id = auth.uid();
exception when unique_violation then
  raise exception 'nickname_taken' using errcode = 'P0001';
end $$;

create or replace function public.set_theme(p_theme text) returns void
language sql security definer set search_path = public as $$
  update profiles set theme = p_theme where id = auth.uid() and p_theme in ('system', 'light', 'dark');
$$;

create or replace function public.my_profile() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', id, 'email', email, 'display_name', display_name, 'nickname', nickname, 'theme', theme,
    'in_leaderboard', in_leaderboard, 'share_activity', share_activity, 'share_matches', share_matches,
    'findable_by_nick', findable_by_nick) from profiles where id = auth.uid();
$$;

create or replace function public.my_boards() returns table (id uuid, kind text, visibility text, title_count int, members json)
language sql stable security definer set search_path = public as $$
  select w.id, w.kind, w.visibility,
    (select count(*)::int from titles t where t.workspace_id = w.id),
    (select json_agg(json_build_object('id', p.id, 'name', coalesce(p.display_name, split_part(p.email, '@', 1)), 'nickname', p.nickname, 'email', p.email) order by m2.joined_at)
       from workspace_members m2 join profiles p on p.id = m2.user_id where m2.workspace_id = w.id)
  from workspaces w join workspace_members m on m.workspace_id = w.id
  where m.user_id = auth.uid()
  order by (w.kind = 'shared');
$$;

-- Email invites now only grant access to the app; joining a board is a
-- separate, accepted invite. The old two-argument invite_email stays for the
-- previous client until drop_legacy.
create or replace function public.invite_email(target_email text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  insert into allowed_emails (email, invited_by) values (lower(trim(target_email)), auth.uid())
  on conflict (email) do nothing;
end $$;

revoke execute on function public.complete_signup() from anon;
revoke execute on function public.nickname_available(text) from anon;
revoke execute on function public.set_profile(text, text) from anon;
revoke execute on function public.set_theme(text) from anon;
revoke execute on function public.my_profile() from anon;
revoke execute on function public.my_boards() from anon;
revoke execute on function public.invite_email(text) from anon;
