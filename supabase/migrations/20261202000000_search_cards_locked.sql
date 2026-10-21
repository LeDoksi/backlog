-- BL-118 (spec 2026-10-21, part 3): a card added from search looks as its
-- source does and nobody edits it; a hand-made card is edited by whoever
-- made it (an old one with no author recorded: by any member of the board).
-- The quiet refresh write (bl.quiet, apply_title_refresh) still changes a
-- search card's face, and now also clears parts_manual when it rebuilds a
-- hand-made list of seasons. Status, ticks, rating, hidden and deleting stay
-- everyone's own business.

create or replace function public.titles_face_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- The SQL editor, the service role, migrations: not a person in the app.
  if auth.uid() is null then return new; end if;
  -- An author deleting their account leaves the card authorless (set null).
  if new.created_by is not null and new.created_by is distinct from old.created_by then
    raise exception 'face_locked' using errcode = '42501', detail = 'created_by';
  end if;
  if (new.title, new.original_title, new.cover, new.synopsis, new.year, new.genres, new.platforms, new.parts,
      new.parts_manual, new.season_info, new.category, new.source, new.source_id, new.release_date, new.digital_date)
     is not distinct from
     (old.title, old.original_title, old.cover, old.synopsis, old.year, old.genres, old.platforms, old.parts,
      old.parts_manual, old.season_info, old.category, old.source, old.source_id, old.release_date, old.digital_date) then
    return new;
  end if;
  if old.source in ('tmdb-movie', 'tmdb-series', 'shikimori', 'steam', 'rawg') and coalesce(old.source_id, '') <> '' then
    if current_setting('bl.quiet', true) = '1' then return new; end if;
    raise exception 'face_locked' using errcode = '42501', detail = 'search card';
  end if;
  if old.created_by is null or old.created_by = auth.uid() then return new; end if;
  raise exception 'face_locked' using errcode = '42501', detail = 'not the author';
end $$;

create trigger titles_face_guard before update on public.titles
  for each row execute function public.titles_face_guard();

-- p_updates rows may now also carry parts_manual (boolean).
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
          cover = x.cover, synopsis = x.synopsis, genres = x.genres, year = x.year, platforms = x.platforms,
          release_date = x.release_date, digital_date = x.digital_date, season_info = x.season_info, parts_manual = x.parts_manual
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
          case when u ? 'year' then (u->>'year')::int else t0.year end as year,
          case when jsonb_typeof(u->'platforms') = 'array' then u->'platforms' else t0.platforms end as platforms,
          case when u ? 'release_date' then (u->>'release_date')::date else t0.release_date end as release_date,
          case when u ? 'digital_date' then (u->>'digital_date')::date else t0.digital_date end as digital_date,
          case when u ? 'season_info' then u->>'season_info' else t0.season_info end as season_info,
          case when jsonb_typeof(u->'parts_manual') = 'boolean' then (u->>'parts_manual')::boolean else t0.parts_manual end as parts_manual
          from titles t0 where t0.workspace_id = p_workspace and t0.id = u->>'id') x
       where t.workspace_id = p_workspace and t.id = u->>'id'
         and (t.parts, t.checked_parts, t.status, t.manual_status, t.airing_status, t.rating,
              t.title, t.original_title, t.cover, t.synopsis, t.genres, t.year,
              t.platforms, t.release_date, t.digital_date, t.season_info, t.parts_manual) is distinct from
             (x.parts, x.checked_parts, x.status, x.manual_status, x.airing_status, x.rating,
              x.title, x.original_title, x.cover, x.synopsis, x.genres, x.year,
              x.platforms, x.release_date, x.digital_date, x.season_info, x.parts_manual);
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
