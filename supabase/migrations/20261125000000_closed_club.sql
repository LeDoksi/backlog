-- Closed club (BL-115): only an admin lets new people in, invite links are
-- single-use, nobody writes invites straight into the tables, the Google
-- name is no longer copied, and a person can delete their own account.
-- admins / is_admin / assert_admin are the names wave 4 (admin screen)
-- builds on. The admin row itself is inserted by the production script.

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on table public.admins from anon, authenticated;

-- For the client: whether to show the invite panel. Not a security check.
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- The check every admin RPC starts with.
create function public.assert_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'not_admin' using errcode = '42501';
  end if;
end $$;

-- v1 let anyone signed in add a row here directly ("insert own invites"),
-- which a stranger's Google sign-in could use to let itself in. Invites
-- now go through the admin RPCs only.
drop policy "insert own invites" on public.allowed_emails;
drop policy "update own invites" on public.allowed_emails;
revoke all on table public.allowed_emails, public.invite_links, public.invite_redemptions from anon, authenticated;

-- An email invite lapses after 30 days unless used. Pending ones get the
-- same 30 days from now; used ones (the person has a profile) are history.
alter table public.allowed_emails add column expires_at timestamptz;
update public.allowed_emails a set expires_at = now() + interval '30 days'
where not exists (select 1 from public.profiles p where p.email = lower(a.email));

-- A link lets in one person. used_at, not used_by, marks it spent: used_by
-- empties when that person deletes their account.
alter table public.invite_links
  add column email text,
  add column used_by uuid references auth.users(id) on delete set null,
  add column used_at timestamptz,
  add column revoked_at timestamptz;
-- Every link made so far was multi-use and some were made by members.
update public.invite_links set revoked_at = now() where revoked_at is null;

-- Deleting an account must not be blocked by rows that only remember who
-- made something.
alter table public.workspaces drop constraint workspaces_created_by_fkey,
  add constraint workspaces_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.titles drop constraint titles_created_by_fkey,
  add constraint titles_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table public.allowed_emails drop constraint allowed_emails_invited_by_fkey,
  add constraint allowed_emails_invited_by_fkey foreign key (invited_by) references auth.users(id) on delete set null;
alter table public.allowed_emails drop constraint allowed_emails_workspace_id_fkey,
  add constraint allowed_emails_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id) on delete set null;

create or replace function public.invite_email(target_email text) returns void
language plpgsql security definer set search_path = public as $$
declare em text := lower(trim(target_email));
begin
  perform assert_admin();
  if em !~ '^[^@\s]+@[^@\s]+$' then raise exception 'bad_email' using errcode = 'P0001'; end if;
  -- Inviting again renews a pending invite; someone already in stays as is.
  insert into allowed_emails (email, invited_by, expires_at) values (em, auth.uid(), now() + interval '30 days')
  on conflict (email) do update set invited_by = excluded.invited_by, expires_at = excluded.expires_at, created_at = now()
  where not exists (select 1 from profiles p where p.email = em);
end $$;

drop function public.create_invite_link();

-- A new single-use link every time, 7 days. With p_email only that Google
-- account can use it, so a forwarded link lets nobody else in.
create function public.create_invite_link(p_email text default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  tok text;
  exp timestamptz := now() + interval '7 days';
  em text := nullif(lower(trim(p_email)), '');
  alphabet constant text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  raw bytea;
begin
  perform assert_admin();
  if em is not null and em !~ '^[^@\s]+@[^@\s]+$' then raise exception 'bad_email' using errcode = 'P0001'; end if;
  loop
    -- gen_random_uuid is core Postgres and cryptographically random; bytes 6
    -- and 8 carry the version and variant, so only the others are used.
    raw := uuid_send(gen_random_uuid());
    tok := '';
    for i in 0..9 loop
      tok := tok || substr(alphabet, get_byte(raw, (array[0,1,2,3,4,5,7,9,10,11])[i + 1]) % 36 + 1, 1);
    end loop;
    begin
      insert into invite_links (token, created_by, expires_at, email) values (tok, auth.uid(), exp, em);
      return json_build_object('token', tok, 'expires_at', exp, 'email', em);
    exception when unique_violation then
      -- astronomically rare; try another token
    end;
  end loop;
end $$;

-- Invites that can still let someone in, for the admin's invite panel.
create function public.admin_invites() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform assert_admin();
  return json_build_object(
    'links', coalesce((
      select json_agg(json_build_object('token', l.token, 'email', l.email, 'created_at', l.created_at, 'expires_at', l.expires_at) order by l.created_at desc)
      from invite_links l where l.revoked_at is null and l.used_at is null and l.expires_at > now()), '[]'::json),
    'emails', coalesce((
      select json_agg(json_build_object('email', a.email, 'created_at', a.created_at, 'expires_at', a.expires_at) order by a.created_at desc)
      from allowed_emails a
      where (a.expires_at is null or a.expires_at > now()) and not exists (select 1 from profiles p where p.email = lower(a.email))), '[]'::json));
end $$;

-- Takes back an invite nobody has used yet; accounts are never touched.
create function public.admin_revoke_invite(p_kind text, p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform assert_admin();
  if p_kind = 'link' then
    update invite_links set revoked_at = now() where token = lower(trim(p_key)) and revoked_at is null and used_at is null;
  elsif p_kind = 'email' then
    delete from allowed_emails a where lower(a.email) = lower(trim(p_key))
      and not exists (select 1 from profiles p where p.email = lower(a.email));
  else
    raise exception 'bad_kind' using errcode = 'P0001';
  end if;
end $$;

-- An existing account following a link: a friend request from the admin
-- who made it. A link spent by someone else, revoked or made by a non-admin
-- counts as expired.
create or replace function public.redeem_invite(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare
  inviter uuid;
  outcome text;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select l.created_by into inviter from invite_links l
   where l.token = lower(trim(p_token)) and l.expires_at > now() and l.revoked_at is null
     and (l.used_at is null or l.used_by = auth.uid())
     and exists (select 1 from admins a where a.user_id = l.created_by);
  if inviter is null then return json_build_object('status', 'expired'); end if;
  outcome := request_friendship(inviter, auth.uid());
  if outcome <> 'self' then
    insert into invite_redemptions (token, user_id, outcome) values (lower(trim(p_token)), auth.uid(), outcome)
    on conflict (token, user_id) do nothing;
  end if;
  return json_build_object('status', outcome,
    'from_name', (select display_name_of(p) from profiles p where p.id = inviter));
end $$;

-- A newcomer gets in with a live email invite or an unspent admin link
-- (bound to their email if it names one). The name starts empty: the
-- person picks what others see on the nickname screen.
create or replace function public.complete_signup(invite_token text default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  tok text := lower(trim(invite_token));
  em text;
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
    if tok is null then return json_build_object('status', 'exists'); end if;
    return json_build_object('status', 'exists', 'invite', redeem_invite(tok));
  end if;
  select lower(trim(u.email)) into em from auth.users u where u.id = uid;
  select * into allowed from allowed_emails a where lower(a.email) = em and (a.expires_at is null or a.expires_at > now());
  if not had_profile and allowed.email is null and tok is not null then
    -- Claiming the link in one update: two people racing on it cannot both get in.
    update invite_links l set used_by = uid, used_at = now()
     where l.token = tok and l.expires_at > now() and l.used_at is null and l.revoked_at is null
       and l.created_by <> uid and exists (select 1 from admins a where a.user_id = l.created_by)
       and (l.email is null or l.email = em)
    returning l.created_by into inviter;
  end if;
  if not had_profile and allowed.email is null and inviter is null then
    if tok is null then return json_build_object('status', 'not_invited'); end if;
    return json_build_object('status', 'not_invited', 'invite', json_build_object('status', 'expired'));
  end if;
  insert into workspaces (kind, created_by) values ('personal', uid) returning id into ws;
  if not had_profile then
    insert into profiles (id, email) values (uid, em);
  end if;
  insert into workspace_members (workspace_id, user_id) values (ws, uid);
  if allowed.email is not null and allowed.workspace_id is not null
     and exists (select 1 from workspaces where id = allowed.workspace_id and kind = 'shared') then
    insert into board_invites (workspace_id, from_user, to_user)
    values (allowed.workspace_id, coalesce(allowed.invited_by, uid), uid)
    on conflict (from_user, to_user) do nothing;
  end if;
  if tok is null then return json_build_object('status', 'created'); end if;
  return json_build_object('status', 'created', 'invite', redeem_invite(tok));
end $$;

create or replace function public.my_profile() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', id, 'email', email, 'display_name', display_name, 'nickname', nickname, 'theme', theme,
    'in_leaderboard', in_leaderboard, 'share_activity', share_activity, 'share_matches', share_matches,
    'findable_by_nick', findable_by_nick, 'is_admin', exists (select 1 from admins a where a.user_id = profiles.id))
  from profiles where id = auth.uid();
$$;

-- Board mates no longer get each other's email, nor its first half as a name.
create or replace function public.my_boards() returns table (id uuid, kind text, visibility text, title_count int, members json, in_leaderboard boolean)
language sql stable security definer set search_path = public as $$
  select w.id, w.kind, w.visibility,
    (select count(*)::int from titles t where t.workspace_id = w.id),
    (select json_agg(json_build_object('id', p.id, 'name', display_name_of(p), 'nickname', p.nickname) order by m2.joined_at)
       from workspace_members m2 join profiles p on p.id = m2.user_id where m2.workspace_id = w.id),
    w.in_leaderboard
  from workspaces w join workspace_members m on m.workspace_id = w.id
  where m.user_id = auth.uid()
  order by (w.kind = 'shared');
$$;

-- Deletes the caller's account. The nickname is typed as confirmation.
-- Boards nobody else is on go too (the personal one always); a shared board
-- stays with the other member, with the titles on it. Friendships, requests,
-- events, links and the profile go by cascade from auth.users; the email
-- invite is removed so the address is not kept.
create function public.delete_my_account(p_nickname text) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  me profiles;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select * into me from profiles where id = uid;
  if me.id is null or me.nickname is null
     or coalesce(lower(ltrim(trim(p_nickname), '@')), '') <> me.nickname::text then
    return json_build_object('status', 'wrong_nickname');
  end if;
  if exists (select 1 from admins where user_id = uid) and not exists (select 1 from admins where user_id <> uid) then
    return json_build_object('status', 'last_admin');
  end if;
  delete from workspaces w
  where exists (select 1 from workspace_members m where m.workspace_id = w.id and m.user_id = uid)
    and not exists (select 1 from workspace_members m where m.workspace_id = w.id and m.user_id <> uid);
  delete from allowed_emails where lower(email) = lower(me.email);
  delete from auth.users where id = uid;
  return json_build_object('status', 'deleted');
end $$;

-- A Google sign-in without an invite still leaves a Supabase Auth user (no
-- profile, no board). Nightly, those older than a day are removed.
create function public.delete_stray_auth_users() returns int
language sql security definer set search_path = public as $$
  with gone as (
    delete from auth.users u where u.created_at < now() - interval '1 day'
      and not exists (select 1 from profiles p where p.id = u.id)
    returning 1)
  select count(*)::int from gone;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.is_admin()', 'public.create_invite_link(text)', 'public.admin_invites()',
    'public.admin_revoke_invite(text,text)', 'public.delete_my_account(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public.assert_admin()', 'public.delete_stray_auth_users()'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Same guard as bl-activity-retention: no pg_cron on the local test Postgres.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('bl-stray-auth', '37 3 * * *', 'select public.delete_stray_auth_users()');
  end if;
end $$;
