-- «Другое» (BL-119): hand-made lines for what search does not cover (books,
-- restaurants, theatre). A table of its own, so nothing about it can reach
-- the feed, stats, leaderboard, matches or friends: all of those read only
-- `titles`. There is no direct access to the table (RLS on, no policies);
-- everything goes through the functions below, which check board membership.
create table public.other_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- The author edits the text and deletes; null once the author's account is
  -- gone, and then any member of the board may.
  created_by uuid references auth.users(id) on delete set null,
  category text not null check (char_length(category) between 1 and 40),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  links jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 3),
  status text not null default 'want' check (status in ('want', 'done')),
  rating int check (rating between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index other_items_workspace_idx on public.other_items (workspace_id, created_at desc);
alter table public.other_items enable row level security;

-- Off by default: the tab shows only for people who switch it on.
alter table public.profiles add column show_other boolean not null default false;

create or replace function public.my_profile() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', id, 'email', email, 'display_name', display_name, 'nickname', nickname, 'theme', theme,
    'in_leaderboard', in_leaderboard, 'share_activity', share_activity, 'share_matches', share_matches,
    'findable_by_nick', findable_by_nick, 'is_admin', is_admin(), 'whats_new_seen_at', whats_new_seen_at,
    'show_other', show_other)
  from profiles where id = auth.uid();
$$;

create function public.set_show_other(p_on boolean) returns void
language sql security definer set search_path = public as $$
  update profiles set show_other = coalesce(p_on, false) where id = auth.uid();
$$;

create function public.other_item_json(i public.other_items) returns json
language sql stable set search_path = public as $$
  select json_build_object('id', i.id, 'category', i.category, 'title', i.title, 'description', i.description,
    'links', i.links, 'status', i.status, 'rating', i.rating, 'created_at', i.created_at,
    'mine', i.created_by is null or i.created_by = auth.uid());
$$;

-- The board's lines, newest first.
create function public.other_items(p_workspace uuid) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not is_member(p_workspace) then raise exception 'not_member' using errcode = 'P0001'; end if;
  return coalesce((select json_agg(other_item_json(i) order by i.created_at desc, i.id)
    from other_items i where i.workspace_id = p_workspace), '[]'::json);
end $$;

-- Adds a line (no `id`, or an `id` not on the board: «Отменить» after a
-- delete brings the line back under its old id and date) or changes one.
-- Status and rating: any member. Category, title, description, links: the
-- author. Category spelling follows the one already on the board, so
-- «книги» lands in «Книги».
create function public.save_other_item(p_workspace uuid, p_item jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cur other_items;
  v_id uuid;
  v_title text := btrim(coalesce(p_item->>'title', ''));
  v_category text := btrim(coalesce(p_item->>'category', ''));
  v_description text := btrim(coalesce(p_item->>'description', ''));
  v_links jsonb := coalesce(p_item->'links', '[]'::jsonb);
  v_status text := coalesce(p_item->>'status', 'want');
  v_rating int;
  v_created timestamptz;
  l jsonb;
  res other_items;
begin
  if uid is null or not is_member(p_workspace) then raise exception 'not_member' using errcode = 'P0001'; end if;
  if p_item is null or jsonb_typeof(p_item) <> 'object' then raise exception 'bad_item' using errcode = 'P0001'; end if;
  if jsonb_typeof(v_links) <> 'array' or jsonb_array_length(v_links) > 3 then raise exception 'bad_links' using errcode = 'P0001'; end if;
  for l in select * from jsonb_array_elements(v_links) loop
    if jsonb_typeof(l) <> 'string' or char_length(l #>> '{}') > 500 or (l #>> '{}') !~* '^https?://[^\s/]+\.[^\s]*$' then
      raise exception 'bad_links' using errcode = 'P0001';
    end if;
  end loop;
  if v_status not in ('want', 'done') then raise exception 'bad_status' using errcode = 'P0001'; end if;
  if p_item ? 'rating' and jsonb_typeof(p_item->'rating') <> 'null' then
    if jsonb_typeof(p_item->'rating') <> 'number' then raise exception 'bad_rating' using errcode = 'P0001'; end if;
    v_rating := (p_item->>'rating')::numeric;
    if v_rating not between 1 and 10 then raise exception 'bad_rating' using errcode = 'P0001'; end if;
  end if;
  if char_length(v_title) not between 1 and 200 then raise exception 'bad_title' using errcode = 'P0001'; end if;
  if char_length(v_category) not between 1 and 40 then raise exception 'bad_category' using errcode = 'P0001'; end if;
  if char_length(v_description) > 2000 then raise exception 'bad_description' using errcode = 'P0001'; end if;
  begin
    v_id := nullif(p_item->>'id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'bad_item' using errcode = 'P0001';
  end;

  if v_id is not null then
    select * into cur from other_items where id = v_id for update;
    if found and cur.workspace_id <> p_workspace then raise exception 'not_found' using errcode = 'P0001'; end if;
  end if;

  if cur.id is not null then
    -- Someone else's line: only status and rating may change.
    if cur.created_by is not null and cur.created_by <> uid
       and (v_title <> cur.title or v_category <> cur.category or v_description <> cur.description or v_links <> cur.links) then
      raise exception 'not_author' using errcode = 'P0001';
    end if;
  end if;

  -- Another line on the board may already spell the category differently.
  select i.category into v_category from other_items i
  where i.workspace_id = p_workspace and lower(i.category) = lower(v_category) and i.id is distinct from cur.id
  order by i.created_at, i.id limit 1;
  if not found then v_category := btrim(coalesce(p_item->>'category', '')); end if;

  if cur.id is not null then
    update other_items set category = v_category, title = v_title, description = v_description, links = v_links,
      status = v_status, rating = v_rating, updated_at = now()
    where id = cur.id returning * into res;
  else
    begin
      v_created := least(coalesce(nullif(p_item->>'created_at', '')::timestamptz, now()), now());
    exception when others then
      v_created := now();
    end;
    insert into other_items (id, workspace_id, created_by, category, title, description, links, status, rating, created_at)
    values (coalesce(v_id, gen_random_uuid()), p_workspace, uid, v_category, v_title, v_description, v_links, v_status, v_rating, v_created)
    returning * into res;
  end if;
  return other_item_json(res);
end $$;

create function public.delete_other_item(p_workspace uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare cur other_items;
begin
  if auth.uid() is null or not is_member(p_workspace) then raise exception 'not_member' using errcode = 'P0001'; end if;
  select * into cur from other_items where id = p_id and workspace_id = p_workspace;
  if cur.id is null then return; end if;
  if cur.created_by is not null and cur.created_by <> auth.uid() then raise exception 'not_author' using errcode = 'P0001'; end if;
  delete from other_items where id = p_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.set_show_other(boolean)', 'public.other_items(uuid)', 'public.save_other_item(uuid,jsonb)', 'public.delete_other_item(uuid,uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'revoke execute on function public.other_item_json(public.other_items) from public, anon, authenticated';
end $$;
revoke all on public.other_items from anon, authenticated;
