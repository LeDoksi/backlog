-- Friends: invite links (which also let a new person into the app), search
-- by nickname, requests and the friend list. Friendship is mutual: a request
-- becomes a friendship when accepted, or at once when both sides asked.

-- One path for every "A asks B": a request B already sent to A means both
-- want it, so it becomes a friendship instead of a second pending request.
create or replace function public.request_friendship(p_from uuid, p_to uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if p_from = p_to then return 'self'; end if;
  if are_friends(p_from, p_to) then return 'already_friends'; end if;
  if exists (select 1 from friend_requests where from_user = p_to and to_user = p_from) then
    insert into friendships (user_a, user_b) values (least(p_from, p_to), greatest(p_from, p_to)) on conflict do nothing;
    delete from friend_requests where (from_user, to_user) in ((p_from, p_to), (p_to, p_from));
    return 'friends';
  end if;
  insert into friend_requests (from_user, to_user) values (p_from, p_to) on conflict (from_user, to_user) do nothing;
  return 'requested';
end $$;

-- What following someone's link did, for the toast after sign-in.
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
  return json_build_object('status', outcome,
    'from_name', (select display_name_of(p) from profiles p where p.id = inviter));
end $$;

drop function if exists public.complete_signup();

-- B's sign-up (idempotent, repairs profiles the legacy trigger made without a
-- board) plus the invite link: a valid token lets a person in who is not on
-- allowed_emails, and either way leaves a friend request from its owner.
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
    insert into profiles (id, email, workspace_id, display_name) values (uid, lower(trim(em)), ws, nullif(trim(full_name), ''));
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

create or replace function public.search_users(p_prefix text)
returns table (id uuid, name text, nickname text, is_friend boolean, requested boolean, incoming boolean)
language sql stable security definer set search_path = public as $$
  select p.id, display_name_of(p), p.nickname::text, are_friends(p.id, auth.uid()),
         exists (select 1 from friend_requests r where r.from_user = auth.uid() and r.to_user = p.id),
         exists (select 1 from friend_requests r where r.from_user = p.id and r.to_user = auth.uid())
  from profiles p
  where auth.uid() is not null and is_app_user(auth.uid()) and p.findable_by_nick and p.nickname is not null and p.id <> auth.uid()
    and length(trim(ltrim(p_prefix, '@'))) >= 2
    and starts_with(p.nickname::text, lower(trim(ltrim(trim(p_prefix), '@'))))
  order by p.nickname
  limit 10;
$$;

create or replace function public.send_friend_request(p_user uuid) returns json
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if not is_app_user(auth.uid()) then raise exception 'not_invited' using errcode = 'P0001'; end if;
  if not exists (select 1 from profiles where id = p_user) then return json_build_object('status', 'not_found'); end if;
  return json_build_object('status', request_friendship(auth.uid(), p_user));
end $$;

create or replace function public.respond_friend_request(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r friend_requests;
begin
  select * into r from friend_requests where id = p_id and to_user = auth.uid();
  if not found then return; end if;
  delete from friend_requests where id = p_id;
  if p_accept then
    insert into friendships (user_a, user_b) values (least(r.from_user, r.to_user), greatest(r.from_user, r.to_user)) on conflict do nothing;
  end if;
end $$;

create or replace function public.remove_friend(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from friendships where user_a = least(p_user, auth.uid()) and user_b = greatest(p_user, auth.uid());
$$;

-- Everything waiting on me: friend requests and shared-board invites.
create or replace function public.my_inbox() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'friend_requests', coalesce((
      select json_agg(json_build_object('id', r.id, 'user_id', p.id, 'name', display_name_of(p), 'nickname', p.nickname, 'at', r.created_at) order by r.created_at desc)
      from friend_requests r join profiles p on p.id = r.from_user where r.to_user = auth.uid()), '[]'::json),
    'board_invites', coalesce((
      select json_agg(json_build_object('id', i.id, 'user_id', p.id, 'name', display_name_of(p), 'nickname', p.nickname, 'at', i.created_at) order by i.created_at desc)
      from board_invites i join profiles p on p.id = i.from_user where i.to_user = auth.uid()), '[]'::json)
  );
$$;

create or replace function public.my_friends() returns table (id uuid, name text, nickname text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, display_name_of(p), p.nickname::text, f.created_at
  from friendships f join profiles p on p.id = case when f.user_a = auth.uid() then f.user_b else f.user_a end
  where auth.uid() in (f.user_a, f.user_b)
  order by display_name_of(p);
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.complete_signup(text)', 'public.create_invite_link()', 'public.redeem_invite(text)', 'public.search_users(text)',
    'public.send_friend_request(uuid)', 'public.respond_friend_request(bigint,boolean)', 'public.remove_friend(uuid)',
    'public.my_inbox()', 'public.my_friends()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'revoke execute on function public.request_friendship(uuid,uuid) from public, anon, authenticated';
  execute 'grant execute on function public.request_friendship(uuid,uuid) to service_role';
end $$;
