-- Old spaces become boards: a space two people share becomes their shared
-- board, a space of one becomes that person's personal board, and everyone in
-- a shared board also gets an empty personal one. Only spaces a profile still
-- points at are touched, so boards made since (by complete_signup or an
-- accepted invite) keep their kind. Re-runnable.
update public.workspaces w set
  kind = case when (select count(*) from public.profiles p where p.workspace_id = w.id) >= 2 then 'shared' else 'personal' end,
  created_by = coalesce(w.created_by, (select p.id from public.profiles p where p.workspace_id = w.id order by p.created_at limit 1))
where exists (select 1 from public.profiles p where p.workspace_id = w.id)
  and not exists (select 1 from public.workspace_members m where m.workspace_id = w.id);

-- Members of old shared spaces first, then old personal spaces for people who
-- do not have a personal board yet.
insert into public.workspace_members (workspace_id, user_id, joined_at)
select p.workspace_id, p.id, p.created_at from public.profiles p join public.workspaces w on w.id = p.workspace_id
where w.kind = 'shared'
on conflict do nothing;

insert into public.workspace_members (workspace_id, user_id, joined_at)
select p.workspace_id, p.id, p.created_at from public.profiles p join public.workspaces w on w.id = p.workspace_id
where w.kind = 'personal'
  and not exists (
    select 1 from public.workspace_members m join public.workspaces w2 on w2.id = m.workspace_id
    where m.user_id = p.id and w2.kind = 'personal')
  and not exists (select 1 from public.workspace_members m where m.workspace_id = p.workspace_id)
on conflict do nothing;

do $$
declare r record; ws uuid;
begin
  for r in
    select p.id as user_id from public.profiles p
    where not exists (
      select 1 from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
      where m.user_id = p.id and w.kind = 'personal')
  loop
    insert into public.workspaces (kind, created_by) values ('personal', r.user_id) returning id into ws;
    insert into public.workspace_members (workspace_id, user_id) values (ws, r.user_id);
  end loop;
end $$;
