-- Baseline: the public schema as v1 left it, read back from the live
-- database on 2026-09-28 (before this, the SQL lived in v1's README and was
-- run by hand). History only: it is already applied and is not meant to be
-- re-run on the live project. The next migration adds drafts.source and
-- drafts.source_id.

-- One shared space per group of invited people.
create table public.workspaces (
  id uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  constraint workspaces_pkey primary key (id)
);

create table public.profiles (
  id uuid not null,
  email text not null,
  workspace_id uuid not null,
  created_at timestamp with time zone not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade,
  constraint profiles_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id)
);

-- Sign-in is by invitation: only emails listed here get a profile.
create table public.allowed_emails (
  email text not null,
  invited_by uuid,
  workspace_id uuid,
  created_at timestamp with time zone not null default now(),
  constraint allowed_emails_pkey primary key (email),
  constraint allowed_emails_invited_by_fkey foreign key (invited_by) references auth.users(id),
  constraint allowed_emails_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id)
);

create or replace function public.current_workspace_id()
 returns uuid
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select workspace_id from profiles where id = auth.uid()
$function$;

-- Titles added by the workspace.
create table public.drafts (
  id text not null,
  title text not null,
  category text not null,
  status text not null default 'queue'::text,
  airing_status text,
  year integer,
  genres jsonb not null default '[]'::jsonb,
  rating integer,
  synopsis text not null default ''::text,
  cover text not null,
  draft boolean not null default true,
  created_at timestamp with time zone not null default now(),
  workspace_id uuid not null default public.current_workspace_id(),
  original_title text,
  season_info text,
  platforms jsonb,
  parts jsonb,
  constraint drafts_pkey primary key (workspace_id, id),
  constraint drafts_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id)
);

-- Per-title edits on top of drafts (status, rating, changed fields).
create table public.overrides (
  id text not null,
  status text,
  rating integer,
  updated_at timestamp with time zone not null default now(),
  title text,
  category text,
  year integer,
  genres jsonb,
  synopsis text,
  cover text,
  original_title text,
  season_info text,
  platforms jsonb,
  parts jsonb,
  draft boolean,
  workspace_id uuid not null default public.current_workspace_id(),
  constraint overrides_pkey primary key (workspace_id, id),
  constraint overrides_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id)
);

-- Checked seasons/parts per title.
create table public.parts (
  id text not null,
  indices jsonb not null default '[]'::jsonb,
  updated_at timestamp with time zone not null default now(),
  workspace_id uuid not null default public.current_workspace_id(),
  constraint parts_pkey primary key (workspace_id, id),
  constraint parts_workspace_id_fkey foreign key (workspace_id) references public.workspaces(id)
);

alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.allowed_emails enable row level security;
alter table public.drafts enable row level security;
alter table public.overrides enable row level security;
alter table public.parts enable row level security;

create policy "read own workspace profiles" on public.profiles for select using (workspace_id = public.current_workspace_id());
create policy "insert own invites" on public.allowed_emails for insert with check (invited_by = auth.uid());
create policy "update own invites" on public.allowed_emails for update using (invited_by = auth.uid());
create policy "workspace members - drafts" on public.drafts for all using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id());
create policy "workspace members - overrides" on public.overrides for all using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id());
create policy "workspace members - parts" on public.parts for all using (workspace_id = public.current_workspace_id()) with check (workspace_id = public.current_workspace_id());

alter publication supabase_realtime add table public.drafts, public.overrides, public.parts;

-- A new sign-in gets a profile only if its email was invited: into the
-- inviter's workspace, or into a fresh one.
create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  invite record;
  new_workspace uuid;
begin
  select * into invite from allowed_emails where email = lower(trim(new.email));
  if not found then
    return new;
  end if;
  if invite.workspace_id is not null then
    insert into profiles (id, email, workspace_id) values (new.id, lower(trim(new.email)), invite.workspace_id);
  else
    insert into workspaces default values returning id into new_workspace;
    insert into profiles (id, email, workspace_id) values (new.id, lower(trim(new.email)), new_workspace);
  end if;
  return new;
end;
$function$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.invite_email(target_email text, add_to_my_workspace boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  my_workspace uuid;
  target_profile_id uuid;
begin
  select workspace_id into my_workspace from profiles where id = auth.uid();
  if my_workspace is null then
    raise exception 'not a workspace member';
  end if;

  insert into allowed_emails (email, invited_by, workspace_id)
  values (
    lower(trim(target_email)),
    auth.uid(),
    case when add_to_my_workspace then my_workspace else null end
  )
  on conflict (email) do update
    set invited_by = excluded.invited_by,
        workspace_id = case
          when add_to_my_workspace then excluded.workspace_id
          else allowed_emails.workspace_id
        end;

  if add_to_my_workspace then
    select id into target_profile_id from profiles where email = lower(trim(target_email));
    if target_profile_id is not null then
      update profiles set workspace_id = my_workspace where id = target_profile_id;
    else
      select id into target_profile_id from auth.users where lower(trim(email)) = lower(trim(target_email));
      if target_profile_id is not null then
        insert into profiles (id, email, workspace_id) values (target_profile_id, lower(trim(target_email)), my_workspace)
          on conflict (id) do update set workspace_id = excluded.workspace_id;
      end if;
    end if;
  end if;
end;
$function$;

create or replace function public.leave_workspace()
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  my_workspace uuid;
  member_count int;
  new_workspace uuid;
begin
  select workspace_id into my_workspace from profiles where id = auth.uid();
  select count(*) into member_count from profiles where workspace_id = my_workspace;
  if member_count <= 1 then
    raise exception 'cannot leave a workspace you are the only member of';
  end if;
  insert into workspaces default values returning id into new_workspace;
  update profiles set workspace_id = new_workspace where id = auth.uid();
end;
$function$;

create or replace function public.remove_member(target_user_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  my_workspace uuid;
  target_workspace uuid;
  member_count int;
  new_workspace uuid;
begin
  select workspace_id into my_workspace from profiles where id = auth.uid();
  select workspace_id into target_workspace from profiles where id = target_user_id;
  if target_workspace is null or target_workspace != my_workspace then
    raise exception 'target is not in your workspace';
  end if;
  select count(*) into member_count from profiles where workspace_id = my_workspace;
  if member_count <= 1 then
    raise exception 'cannot remove the only member of a workspace';
  end if;
  insert into workspaces default values returning id into new_workspace;
  update profiles set workspace_id = new_workspace where id = target_user_id;
end;
$function$;

revoke execute on function public.invite_email(text, boolean) from anon;
revoke execute on function public.leave_workspace() from anon;
revoke execute on function public.remove_member(uuid) from anon;
