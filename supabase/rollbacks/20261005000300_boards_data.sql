-- Undo 20261005000300_boards_data: forget memberships and board kinds, drop
-- the empty personal boards it made. Titles rows, if migrated, go with the
-- titles table in the boards_profiles_titles rollback.
delete from public.workspace_members;
delete from public.workspaces w
where not exists (select 1 from public.profiles p where p.workspace_id = w.id)
  and not exists (select 1 from public.drafts d where d.workspace_id = w.id)
  and not exists (select 1 from public.allowed_emails a where a.workspace_id = w.id)
  and not exists (select 1 from public.titles t where t.workspace_id = w.id);
update public.workspaces set kind = 'personal', created_by = null;
