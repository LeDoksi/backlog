-- B11: the v1 schema goes. Nothing reads it since phase B (2026-09-28): the
-- app works on `titles`, boards and workspace_members. Archive before this
-- ran: backups/backlog-db-2026-10-02-before-drop-legacy.json in the project
-- files and the schema backup_20261002_drop_legacy in the database.
-- Irreversible on purpose: no rollback file. To undo, recreate the objects
-- from 20260925000000_baseline.sql and copy the rows back from the backup schema.

alter publication supabase_realtime drop table public.drafts, public.overrides, public.parts;
drop table public.overrides;
drop table public.parts;
drop table public.drafts;

-- Sign-up is complete_signup's job alone; the v1 trigger made a profile in
-- the inviter's old space for every invited Google sign-in.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.leave_workspace();
drop function if exists public.remove_member(uuid);
drop function if exists public.invite_email(text, boolean);
drop function if exists public.my_boards_before_leaderboard();

-- Profiles were readable across a v1 space; now each person reads their own
-- row (the app checks it exists) and everything else goes through RPCs.
drop policy "read own workspace profiles" on public.profiles;
create policy "read own profile" on public.profiles for select using (id = auth.uid());

-- Same as in 20261020000100_friends, without profiles.workspace_id.
create or replace function public.complete_signup(invite_token text default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  em text;
  full_name text;
  allowed record;
  inviter uuid;
  ws uuid;
  had_profile boolean;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  had_profile := exists (select 1 from profiles where id = uid);
  if had_profile and exists (
    select 1 from workspace_members m join workspaces w on w.id = m.workspace_id
    where m.user_id = uid and w.kind = 'personal'
  ) then
    if invite_token is null then return json_build_object('status', 'exists'); end if;
    return json_build_object('status', 'exists', 'invite', redeem_invite(invite_token));
  end if;
  select u.email, u.raw_user_meta_data->>'full_name' into em, full_name from auth.users u where u.id = uid;
  select * into allowed from allowed_emails a where lower(a.email) = lower(trim(em));
  if invite_token is not null then
    -- Only a link made by someone already in the app opens the door.
    select created_by into inviter from invite_links
     where token = lower(trim(invite_token)) and expires_at > now() and created_by <> uid and is_app_user(created_by);
  end if;
  if not had_profile and allowed is null and inviter is null then
    if invite_token is null then return json_build_object('status', 'not_invited'); end if;
    return json_build_object('status', 'not_invited', 'invite', json_build_object('status', 'expired'));
  end if;
  insert into workspaces (kind, created_by) values ('personal', uid) returning id into ws;
  if had_profile then
    update profiles set display_name = coalesce(display_name, nullif(trim(full_name), '')) where id = uid;
  else
    insert into profiles (id, email, display_name) values (uid, lower(trim(em)), nullif(trim(full_name), ''));
  end if;
  insert into workspace_members (workspace_id, user_id) values (ws, uid);
  if allowed is not null and allowed.workspace_id is not null
     and exists (select 1 from workspaces where id = allowed.workspace_id and kind = 'shared') then
    insert into board_invites (workspace_id, from_user, to_user)
    values (allowed.workspace_id, coalesce(allowed.invited_by, uid), uid)
    on conflict (from_user, to_user) do nothing;
  end if;
  if invite_token is null then return json_build_object('status', 'created'); end if;
  return json_build_object('status', 'created', 'invite', redeem_invite(invite_token));
end $$;

alter table public.profiles drop column workspace_id;
drop function if exists public.current_workspace_id();
