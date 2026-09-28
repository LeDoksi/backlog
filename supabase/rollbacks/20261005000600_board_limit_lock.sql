-- Back to the trigger without locks.
create or replace function public.enforce_board_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  select kind into k from workspaces where id = new.workspace_id;
  if exists (
    select 1 from workspace_members m join workspaces w on w.id = m.workspace_id
    where m.user_id = new.user_id and w.kind = k and m.workspace_id <> new.workspace_id
  ) then
    raise exception 'board_limit: already has a % board', k using errcode = 'P0001';
  end if;
  if k = 'personal' and exists (select 1 from workspace_members where workspace_id = new.workspace_id and user_id <> new.user_id) then
    raise exception 'board_limit: personal board has a single member' using errcode = 'P0001';
  end if;
  return new;
end $$;
