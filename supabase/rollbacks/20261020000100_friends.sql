-- Undo 20261020000100_friends: B's complete_signup() without the token.
drop function if exists public.my_friends();
drop function if exists public.my_inbox();
drop function if exists public.remove_friend(uuid);
drop function if exists public.respond_friend_request(bigint, boolean);
drop function if exists public.send_friend_request(uuid);
drop function if exists public.search_users(text);
drop function if exists public.create_invite_link();
drop function if exists public.complete_signup(text);
drop function if exists public.redeem_invite(text);
drop function if exists public.request_friendship(uuid, uuid);
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
revoke execute on function public.complete_signup() from public, anon;
grant execute on function public.complete_signup() to authenticated, service_role;
