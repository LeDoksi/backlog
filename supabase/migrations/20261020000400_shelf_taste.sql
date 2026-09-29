-- A friend's page: who they are, their shelf by tab, and how close our
-- tastes are. Everything is computed over what each of us may see of the
-- other (visible_titles_for), never over the raw tables.

-- Only for someone I have a reason to see: a friend, a board mate, or a
-- person with a board open to everyone. Anyone else is "not found".
create or replace function public.friend_profile(p_user uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', p.id, 'name', display_name_of(p), 'nickname', p.nickname,
    'is_friend', f.created_at is not null, 'since', f.created_at)
  from profiles p
  left join friendships f on f.user_a = least(p.id, auth.uid()) and f.user_b = greatest(p.id, auth.uid())
  where p.id = p_user and auth.uid() is not null and p.id <> auth.uid() and (
    f.created_at is not null
    or exists (select 1 from workspace_members a join workspace_members b on b.workspace_id = a.workspace_id
               where a.user_id = p.id and b.user_id = auth.uid())
    or exists (select 1 from workspace_members m join workspaces w on w.id = m.workspace_id
               where m.user_id = p.id and w.visibility = 'everyone'));
$$;

create or replace function public.friend_shelf(p_user uuid, p_status text)
returns table (id text, title text, category text, year int, cover text, common boolean)
language sql stable security definer set search_path = public as $$
  with mine as (select title_key(source, source_id, id) k from visible_titles(auth.uid()))
  select t.id, t.title, t.category, t.year, t.cover, title_key(t.source, t.source_id, t.id) in (select k from mine)
  from visible_titles(p_user) t
  where p_user <> auth.uid() and case p_status
    when 'watching' then t.status = 'in_progress'
    when 'want' then t.status in ('queue', 'unreleased')
    when 'done' then t.status = 'done'
    else false end
  order by t.completed_at desc nulls last, t.updated_at desc;
$$;

-- Decision 52: 60% shared finished titles, 30% genres, 10% "want". Each
-- side is what the other may see of it, hidden titles never count (spec 7.4).
create or replace function public.taste_match(p_user uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  d1 text[]; d2 text[]; w1 text[]; w2 text[]; n1 int; n2 int;
  common int; both_want int;
  t numeric; g numeric; w numeric; top text[];
  score numeric := 0; weight numeric := 0;
begin
  if me is null or p_user = me then return json_build_object('status', 'disabled'); end if;
  if not coalesce((select share_matches from profiles where id = p_user), false)
     or not coalesce((select share_matches from profiles where id = me), false) then
    return json_build_object('status', 'disabled');
  end if;
  select count(*), coalesce(array_agg(title_key(x.source, x.source_id, x.id)) filter (where x.status = 'done'), '{}'),
         coalesce(array_agg(title_key(x.source, x.source_id, x.id)) filter (where x.status = 'queue'), '{}')
    into n1, d1, w1 from visible_titles_for(me, p_user) x where not x.hidden;
  select count(*), coalesce(array_agg(title_key(x.source, x.source_id, x.id)) filter (where x.status = 'done'), '{}'),
         coalesce(array_agg(title_key(x.source, x.source_id, x.id)) filter (where x.status = 'queue'), '{}')
    into n2, d2, w2 from visible_titles_for(p_user, me) x where not x.hidden;
  if n1 < 5 or n2 < 5 then return json_build_object('status', 'not_enough'); end if;

  common := cardinality(array(select unnest(d1) intersect select unnest(d2)));
  both_want := cardinality(array(select unnest(w1) intersect select unnest(w2)));

  -- T: cosine of the finished sets.
  if cardinality(d1) > 0 and cardinality(d2) > 0 then
    t := common / sqrt(cardinality(d1)::numeric * cardinality(d2));
  end if;

  -- G: cosine of genre counts over finished and in-progress titles.
  with a as (select gg, count(*)::numeric c from visible_titles_for(me, p_user) x, jsonb_array_elements_text(x.genres) gg
             where not x.hidden and x.status in ('done', 'in_progress') group by gg),
       b as (select gg, count(*)::numeric c from visible_titles_for(p_user, me) x, jsonb_array_elements_text(x.genres) gg
             where not x.hidden and x.status in ('done', 'in_progress') group by gg),
       na as (select sqrt(sum(c * c)) n from a), nb as (select sqrt(sum(c * c)) n from b)
  select coalesce((select sum(a.c * b.c) from a join b using (gg)), 0) / nullif((select n from na) * (select n from nb), 0),
         (select array_agg(gg order by m desc, gg) from (select a.gg, least(a.c, b.c) m from a join b using (gg) order by m desc, a.gg limit 3) z)
    into g, top;

  -- W: how much of each one's "want" the other already wants or finished,
  -- so identical shelves give 1 (the spec's normalisation could not).
  if cardinality(w1) + cardinality(w2) > 0 then
    w := (cardinality(array(select unnest(w1) intersect select unnest(w2 || d2)))
        + cardinality(array(select unnest(w2) intersect select unnest(w1 || d1))))::numeric
       / (cardinality(w1) + cardinality(w2));
  end if;

  -- A part neither side has data for (nobody finished anything, no genres,
  -- nobody wants anything) is left out and the weights re-balanced.
  if t is not null then score := score + 0.6 * t; weight := weight + 0.6; end if;
  if g is not null then score := score + 0.3 * g; weight := weight + 0.3; end if;
  if w is not null then score := score + 0.1 * w; weight := weight + 0.1; end if;

  return json_build_object('status', 'ok',
    'percent', case when weight = 0 then 0 else round(100 * score / weight)::int end,
    'common', common, 'both_want', both_want, 'genres', coalesce(to_json(top), '[]'::json));
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.friend_profile(uuid)', 'public.friend_shelf(uuid,text)', 'public.taste_match(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
