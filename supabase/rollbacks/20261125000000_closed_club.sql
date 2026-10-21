-- Undo 20261125000000_closed_club: the open invites of phase D. Links that
-- were revoked, spent or bound to one email are expired first, so dropping
-- those columns does not turn them into open links; admins and deleted
-- accounts are not restored.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('bl-stray-auth');
  end if;
end $$;
drop function if exists public.delete_stray_auth_users();
drop function if exists public.delete_my_account(text);
drop function if exists public.admin_revoke_invite(text, text);
drop function if exists public.admin_invites();
drop function if exists public.create_invite_link(text);

create or replace function public.my_boards() returns table (id uuid, kind text, visibility text, title_count int, members json, in_leaderboard boolean)
language sql stable security definer set search_path = public as $$
  select w.id, w.kind, w.visibility,
    (select count(*)::int from titles t where t.workspace_id = w.id),
    (select json_agg(json_build_object('id', p.id, 'name', coalesce(p.display_name, split_part(p.email, '@', 1)), 'nickname', p.nickname, 'email', p.email) order by m2.joined_at)
       from workspace_members m2 join profiles p on p.id = m2.user_id where m2.workspace_id = w.id),
    w.in_leaderboard
  from workspaces w join workspace_members m on m.workspace_id = w.id
  where m.user_id = auth.uid()
  order by (w.kind = 'shared');
$$;

create or replace function public.find_user_by_nick(p_nickname text) returns table (id uuid, name text, nickname text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(p.display_name, split_part(p.email, '@', 1)), p.nickname::text
  from profiles p where p.nickname = lower(p_nickname) and p.findable_by_nick and p.id <> auth.uid();
$$;

create or replace function public.my_board_invites() returns table (id bigint, from_id uuid, from_name text, from_nickname text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, p.id, coalesce(p.display_name, split_part(p.email, '@', 1)), p.nickname::text, i.created_at
  from board_invites i join profiles p on p.id = i.from_user where i.to_user = auth.uid() order by i.created_at desc;
$$;

create or replace function public.my_profile() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', id, 'email', email, 'display_name', display_name, 'nickname', nickname, 'theme', theme,
    'in_leaderboard', in_leaderboard, 'share_activity', share_activity, 'share_matches', share_matches,
    'findable_by_nick', findable_by_nick) from profiles where id = auth.uid();
$$;

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

create or replace function public.redeem_invite(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare
  inviter uuid;
  outcome text;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select created_by into inviter from invite_links where token = lower(trim(p_token)) and expires_at > now();
  if inviter is null then return json_build_object('status', 'expired'); end if;
  outcome := request_friendship(inviter, auth.uid());
  if outcome <> 'self' then
    insert into invite_redemptions (token, user_id, outcome) values (lower(trim(p_token)), auth.uid(), outcome)
    on conflict (token, user_id) do nothing;
  end if;
  return json_build_object('status', outcome,
    'from_name', (select display_name_of(p) from profiles p where p.id = inviter));
end $$;


-- A link lives 7 days and can be used by many people. The same link is
-- handed out again while it has more than a day left, so sharing it twice
-- in a row does not leave several live links behind.
create or replace function public.create_invite_link() returns json
language plpgsql security definer set search_path = public as $$
declare
  tok text;
  exp timestamptz;
  alphabet constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  raw bytea;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not is_app_user(auth.uid()) then raise exception 'not_invited' using errcode = 'P0001'; end if;
  select token, expires_at into tok, exp from invite_links
    where created_by = auth.uid() and expires_at > now() + interval '1 day' order by created_at desc limit 1;
  if tok is not null then return json_build_object('token', tok, 'expires_at', exp); end if;
  loop
    -- gen_random_uuid is core Postgres and cryptographically random; bytes 6
    -- and 8 carry the version and variant, so only the others are used.
    raw := uuid_send(gen_random_uuid());
    tok := '';
    for i in 0..9 loop
      tok := tok || substr(alphabet, get_byte(raw, (array[0,1,2,3,4,5,7,9,10,11])[i + 1]) % 36 + 1, 1);
    end loop;
    exp := now() + interval '7 days';
    begin
      insert into invite_links (token, created_by, expires_at) values (tok, auth.uid(), exp);
      return json_build_object('token', tok, 'expires_at', exp);
    exception when unique_violation then
      -- astronomically rare; try another token
    end;
  end loop;
end $$;
revoke execute on function public.create_invite_link() from public, anon;
grant execute on function public.create_invite_link() to authenticated, service_role;

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

alter table public.allowed_emails drop constraint allowed_emails_workspace_id_fkey,
  add constraint allowed_emails_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id);
alter table public.allowed_emails drop constraint allowed_emails_invited_by_fkey,
  add constraint allowed_emails_invited_by_fkey foreign key (invited_by) references auth.users(id);
alter table public.titles drop constraint titles_created_by_fkey,
  add constraint titles_created_by_fkey foreign key (created_by) references auth.users(id);
alter table public.workspaces drop constraint workspaces_created_by_fkey,
  add constraint workspaces_created_by_fkey foreign key (created_by) references auth.users(id);

update public.invite_links set expires_at = least(expires_at, now())
where revoked_at is not null or used_at is not null or email is not null;
alter table public.invite_links drop column revoked_at, drop column used_at, drop column used_by, drop column email;
alter table public.allowed_emails drop column expires_at;
-- Same grant order as before, so the ACL reads the same.
revoke all on table public.allowed_emails, public.invite_links from service_role;
grant all on table public.allowed_emails, public.invite_links to anon, authenticated, service_role;
create policy "insert own invites" on public.allowed_emails for insert with check (invited_by = auth.uid());
create policy "update own invites" on public.allowed_emails for update using (invited_by = auth.uid());

drop function if exists public.assert_admin();
drop function if exists public.is_admin();
drop table if exists public.admins;
