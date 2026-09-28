-- Shared-board invites by nickname, leaving, removing a member, and copying a
-- title between one's own boards. Every membership change goes through these
-- security-definer functions; there is no direct write to workspace_members.
create table if not exists public.board_invites (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_user, to_user)
);
-- RLS and its policy come with the table in signup_profile.

create or replace function public.find_user_by_nick(p_nickname text) returns table (id uuid, name text, nickname text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(p.display_name, split_part(p.email, '@', 1)), p.nickname::text
  from profiles p where p.nickname = lower(p_nickname) and p.findable_by_nick and p.id <> auth.uid();
$$;

create or replace function public.invite_to_shared_board(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mine uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if p_user = auth.uid() then raise exception 'cannot_invite_self' using errcode = 'P0001'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'not_found' using errcode = 'P0001'; end if;
  select m.workspace_id into mine from workspace_members m join workspaces w on w.id = m.workspace_id
    where m.user_id = auth.uid() and w.kind = 'shared';
  if exists (select 1 from workspace_members m join workspaces w on w.id = m.workspace_id
             where m.user_id = p_user and w.kind = 'shared' and w.id is distinct from mine) then
    raise exception 'target_has_shared' using errcode = 'P0001';
  end if;
  if mine is not null and exists (select 1 from workspace_members where workspace_id = mine and user_id = p_user) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  insert into board_invites (workspace_id, from_user, to_user) values (mine, auth.uid(), p_user)
  on conflict (from_user, to_user) do update set workspace_id = excluded.workspace_id, created_at = now();
end $$;

create or replace function public.my_board_invites() returns table (id bigint, from_id uuid, from_name text, from_nickname text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, p.id, coalesce(p.display_name, split_part(p.email, '@', 1)), p.nickname::text, i.created_at
  from board_invites i join profiles p on p.id = i.from_user where i.to_user = auth.uid() order by i.created_at desc;
$$;

create or replace function public.respond_board_invite(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare inv board_invites; ws uuid;
begin
  select * into inv from board_invites where id = p_id and to_user = auth.uid();
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  delete from board_invites where id = p_id;
  if not p_accept then return; end if;
  ws := inv.workspace_id;
  if ws is null then
    select m.workspace_id into ws from workspace_members m join workspaces w on w.id = m.workspace_id
      where m.user_id = inv.from_user and w.kind = 'shared';
    if ws is null then
      insert into workspaces (kind, created_by) values ('shared', inv.from_user) returning id into ws;
      insert into workspace_members (workspace_id, user_id) values (ws, inv.from_user);
    end if;
  end if;
  insert into workspace_members (workspace_id, user_id) values (ws, auth.uid());
end $$;

create or replace function public.leave_shared_board() returns void
language sql security definer set search_path = public as $$
  delete from workspace_members m using workspaces w
  where m.workspace_id = w.id and w.kind = 'shared' and m.user_id = auth.uid();
$$;

create or replace function public.remove_board_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select m.workspace_id into ws from workspace_members m join workspaces w on w.id = m.workspace_id
    where m.user_id = auth.uid() and w.kind = 'shared';
  if ws is null then raise exception 'no_shared_board' using errcode = 'P0001'; end if;
  delete from workspace_members where workspace_id = ws and user_id = p_user and p_user <> auth.uid();
end $$;

-- A copy is an independent record: metadata travels, progress does not.
create or replace function public.copy_title(p_title_id text, p_from uuid, p_to uuid) returns void
language plpgsql security definer set search_path = public as $$
declare src titles;
begin
  if not (is_member(p_from) and is_member(p_to)) then raise exception 'not_member' using errcode = 'P0001'; end if;
  select * into src from titles where workspace_id = p_from and id = p_title_id;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if exists (select 1 from titles t where t.workspace_id = p_to and (t.id = src.id
      or (src.source is not null and t.source = src.source and t.source_id = src.source_id))) then
    raise exception 'duplicate' using errcode = 'P0001';
  end if;
  insert into titles (workspace_id, id, title, original_title, category, status, airing_status, year, genres, synopsis,
                      cover, season_info, platforms, parts, source, source_id)
  values (p_to, src.id, src.title, src.original_title, src.category,
          case when src.status = 'unreleased' then 'unreleased' else 'queue' end,
          src.airing_status, src.year, src.genres, src.synopsis, src.cover, src.season_info, src.platforms, src.parts,
          src.source, src.source_id);
end $$;

revoke execute on function public.find_user_by_nick(text) from anon;
revoke execute on function public.invite_to_shared_board(uuid) from anon;
revoke execute on function public.my_board_invites() from anon;
revoke execute on function public.respond_board_invite(bigint, boolean) from anon;
revoke execute on function public.leave_shared_board() from anon;
revoke execute on function public.remove_board_member(uuid) from anon;
revoke execute on function public.copy_title(text, uuid, uuid) from anon;
