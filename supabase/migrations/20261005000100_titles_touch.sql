-- Timestamps follow status changes. A row inserted with a created_at in the
-- past is a migrated title: its dates are unknown, so they stay as given
-- instead of pretending it was finished today.
create or replace function public.titles_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.created_at < now() - interval '1 minute' then return new; end if;
    if new.status = 'in_progress' then new.started_at := coalesce(new.started_at, now()); end if;
    if new.status = 'done' then new.completed_at := coalesce(new.completed_at, now()); end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'in_progress' and new.started_at is null then new.started_at := now(); end if;
    if new.status = 'done' then new.completed_at := now(); end if;
    if old.status = 'done' and new.status <> 'done' then new.completed_at := null; end if;
  end if;
  return new;
end $$;
create trigger titles_touch before insert or update on public.titles
  for each row execute function public.titles_touch();
