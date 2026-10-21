-- Undo 20261201000000_release_dates: the wave 3 bodies again, then the
-- columns go. Roll the app back first: it writes release_date on add.

create or replace function public.refresh_base_ok(t public.titles, base jsonb) returns boolean
language sql immutable as $$
  select base is not null
     and coalesce(t.parts, 'null'::jsonb) = coalesce(base->'parts', 'null'::jsonb)
     and t.checked_parts = coalesce(base->'checked_parts', '{}'::jsonb)
     and t.status = base->>'status'
     and (not base ? 'title' or t.title is not distinct from base->>'title')
     and (not base ? 'original_title' or t.original_title is not distinct from base->>'original_title')
     and (not base ? 'cover' or t.cover is not distinct from base->>'cover')
     and (not base ? 'synopsis' or t.synopsis is not distinct from base->>'synopsis')
     and (not base ? 'genres' or coalesce(t.genres, 'null'::jsonb) = coalesce(base->'genres', 'null'::jsonb))
     and (not base ? 'year' or t.year is not distinct from (base->>'year')::int);
$$;

-- p_updates rows may now also carry title, original_title, cover,
-- synopsis, genres (array) and year; a key that is absent leaves the column
-- as it is. An empty title is never written.
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
          parts = x.parts, checked_parts = x.checked_parts, status = x.status, manual_status = x.manual_status,
          airing_status = x.airing_status, rating = x.rating, title = x.title, original_title = x.original_title,
          cover = x.cover, synopsis = x.synopsis, genres = x.genres, year = x.year
        from (select
          case when jsonb_typeof(u->'parts') = 'array' then u->'parts' else t0.parts end as parts,
          case when jsonb_typeof(u->'checked_parts') = 'object' then u->'checked_parts' else t0.checked_parts end as checked_parts,
          coalesce(u->>'status', t0.status) as status,
          case when u ? 'manual_status' then u->>'manual_status' else t0.manual_status end as manual_status,
          case when u ? 'airing_status' then u->>'airing_status' else t0.airing_status end as airing_status,
          case when u ? 'rating' then (u->>'rating')::int else t0.rating end as rating,
          coalesce(nullif(btrim(u->>'title'), ''), t0.title) as title,
          case when u ? 'original_title' then u->>'original_title' else t0.original_title end as original_title,
          case when u ? 'cover' then u->>'cover' else t0.cover end as cover,
          case when u ? 'synopsis' then u->>'synopsis' else t0.synopsis end as synopsis,
          case when jsonb_typeof(u->'genres') = 'array' then u->'genres' else t0.genres end as genres,
          case when u ? 'year' then (u->>'year')::int else t0.year end as year
          from titles t0 where t0.workspace_id = p_workspace and t0.id = u->>'id') x
       where t.workspace_id = p_workspace and t.id = u->>'id'
         and (t.parts, t.checked_parts, t.status, t.manual_status, t.airing_status, t.rating,
              t.title, t.original_title, t.cover, t.synopsis, t.genres, t.year) is distinct from
             (x.parts, x.checked_parts, x.status, x.manual_status, x.airing_status, x.rating,
              x.title, x.original_title, x.cover, x.synopsis, x.genres, x.year);
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

alter table public.titles drop column release_date, drop column digital_date;
