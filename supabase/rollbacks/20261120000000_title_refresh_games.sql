-- Undo 20261120000000_title_refresh_games: the wave 2 bodies again. Roll the
-- app back first: the wave 3 client sends card fields the old function ignores
-- (harmless) but its base check would no longer guard them.

-- The row is still what the client based its edit on.
create or replace function public.refresh_base_ok(t public.titles, base jsonb) returns boolean
language sql immutable as $$
  select base is not null
     and coalesce(t.parts, 'null'::jsonb) = coalesce(base->'parts', 'null'::jsonb)
     and t.checked_parts = coalesce(base->'checked_parts', '{}'::jsonb)
     and t.status = base->>'status';
$$;

-- The daily refresh's one write (spec 2.5). p_updates: [{id, base, parts,
-- checked_parts, status, manual_status, airing_status, rating}] (a merge
-- keeps the highest rating), p_deletes: [{id,
-- base}], where base = {parts, checked_parts, status} as the client saw the
-- row. A row that changed since (another device, a tick made meanwhile)
-- makes the whole call a no-op that answers -1: the client reloads and tries
-- again later, so nothing anyone did is overwritten and a merge is never
-- half done. Otherwise the answer is how many rows changed; a second call
-- with the same data changes none.
create or replace function public.apply_title_refresh(p_workspace uuid, p_updates jsonb, p_deletes jsonb default '[]')
returns int
language plpgsql security definer set search_path = public as $$
declare
  u jsonb;
  n int := 0;
  c int;
begin
  if auth.uid() is null or not is_member(p_workspace) then return 0; end if;
  perform set_config('bl.quiet', '1', true);
  begin
    for u in select * from jsonb_array_elements(coalesce(p_updates, '[]')) loop
      perform 1 from titles t
       where t.workspace_id = p_workspace and t.id = u->>'id' and refresh_base_ok(t, u->'base')
       for update;
      if not found then raise exception 'stale' using errcode = 'P0001'; end if;
      update titles t set
          parts = case when jsonb_typeof(u->'parts') = 'array' then u->'parts' else t.parts end,
          checked_parts = case when jsonb_typeof(u->'checked_parts') = 'object' then u->'checked_parts' else t.checked_parts end,
          status = coalesce(u->>'status', t.status),
          manual_status = case when u ? 'manual_status' then u->>'manual_status' else t.manual_status end,
          airing_status = case when u ? 'airing_status' then u->>'airing_status' else t.airing_status end,
          rating = case when u ? 'rating' then (u->>'rating')::int else t.rating end
       where t.workspace_id = p_workspace and t.id = u->>'id'
         and (t.parts, t.checked_parts, t.status, t.manual_status, t.airing_status, t.rating) is distinct from
             (case when jsonb_typeof(u->'parts') = 'array' then u->'parts' else t.parts end,
              case when jsonb_typeof(u->'checked_parts') = 'object' then u->'checked_parts' else t.checked_parts end,
              coalesce(u->>'status', t.status),
              case when u ? 'manual_status' then u->>'manual_status' else t.manual_status end,
              case when u ? 'airing_status' then u->>'airing_status' else t.airing_status end,
              case when u ? 'rating' then (u->>'rating')::int else t.rating end);
      get diagnostics c = row_count;
      n := n + c;
    end loop;
    for u in select * from jsonb_array_elements(coalesce(p_deletes, '[]')) loop
      delete from titles t where t.workspace_id = p_workspace and t.id = u->>'id' and refresh_base_ok(t, u->'base');
      get diagnostics c = row_count;
      if c = 0 and exists (select 1 from titles t where t.workspace_id = p_workspace and t.id = u->>'id') then
        raise exception 'stale' using errcode = 'P0001';
      end if;
      n := n + c;
    end loop;
  exception when sqlstate 'P0001' then
    perform set_config('bl.quiet', '', true);
    return -1;
  end;
  perform set_config('bl.quiet', '', true);
  return n;
end $$;
