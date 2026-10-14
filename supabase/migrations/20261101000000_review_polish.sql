-- Wave 1 of the review (spec 2026-10-14, 1.1-1.9): the friend's title card
-- reads one title through friend_title(); the feed carries the rating of a
-- finished title and the ids behind an additions line's covers; the taste
-- match weighs how close the ratings are.

-- One title of someone else's shelf for the friend's title card (spec 1.3):
-- only what visible_titles_for lets me see, so hidden titles and closed
-- boards answer null. mine_id is my own copy of the same title, if any.
create function public.friend_title(p_owner uuid, p_id text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', t.id, 'title', t.title, 'original_title', t.original_title, 'category', t.category,
    'year', t.year, 'genres', t.genres, 'synopsis', t.synopsis, 'cover', t.cover, 'platforms', t.platforms,
    'parts', t.parts, 'checked', coalesce((select json_agg(k::int order by k::int) from jsonb_object_keys(t.checked_parts) k where k ~ '^[0-9]+$'), '[]'::json),
    'status', t.status, 'rating', t.rating, 'title_key', title_key(t.source, t.source_id, t.id),
    'mine_id', (select m.id from visible_titles(auth.uid()) m
                where title_key(m.source, m.source_id, m.id) = title_key(t.source, t.source_id, t.id) limit 1))
  from visible_titles_for(p_owner, auth.uid()) t
  where t.id = p_id and auth.uid() is not null
  limit 1;
$$;

create or replace function public.taste_match(p_user uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  d1 text[]; d2 text[]; w1 text[]; w2 text[]; n1 int; n2 int;
  common int; both_want int;
  t numeric; g numeric; w numeric; top text[];
  score numeric := 0; weight numeric := 0;
  r numeric; rated int;
begin
  if me is null or p_user = me then return json_build_object('status', 'disabled'); end if;
  -- Someone without a page for me gets the same answer whatever their
  -- switches say, so the call cannot be used to read anyone's settings.
  if friend_profile(p_user) is null then return json_build_object('status', 'not_enough'); end if;
  if not coalesce((select share_matches from profiles where id = p_user), false)
     or not coalesce((select share_matches from profiles where id = me), false) then
    return json_build_object('status', 'disabled');
  end if;
  select count(*), coalesce(array_agg(title_key(x.source, x.source_id, x.id)) filter (where x.status = 'done'), '{}'),
         coalesce(array_agg(title_key(x.source, x.source_id, x.id)) filter (where x.status = 'queue'), '{}')
    into n1, d1, w1 from visible_titles_for(me, p_user) x where not x.hidden and not on_common_board(x.workspace_id, me, p_user);
  select count(*), coalesce(array_agg(title_key(x.source, x.source_id, x.id)) filter (where x.status = 'done'), '{}'),
         coalesce(array_agg(title_key(x.source, x.source_id, x.id)) filter (where x.status = 'queue'), '{}')
    into n2, d2, w2 from visible_titles_for(p_user, me) x where not x.hidden and not on_common_board(x.workspace_id, me, p_user);
  if n1 < 5 or n2 < 5 then return json_build_object('status', 'not_enough'); end if;

  common := cardinality(array(select unnest(d1) intersect select unnest(d2)));
  both_want := cardinality(array(select unnest(w1) intersect select unnest(w2)));

  -- T: cosine of the finished sets.
  if cardinality(d1) > 0 and cardinality(d2) > 0 then
    t := common / sqrt(cardinality(d1)::numeric * cardinality(d2));
  end if;

  -- R: how close the ratings are on shared finished titles both rated
  -- (1 for the same marks, 0 for 1 against 10). With three or more such
  -- titles it takes 20% of the finished part (spec 1.9).
  select 1 - avg(abs(a.rating - b.rating))::numeric / 9, count(*)
    into r, rated
  from visible_titles_for(me, p_user) a
  join visible_titles_for(p_user, me) b on title_key(b.source, b.source_id, b.id) = title_key(a.source, a.source_id, a.id)
  where a.status = 'done' and b.status = 'done' and a.rating is not null and b.rating is not null
    and not a.hidden and not b.hidden
    and not on_common_board(a.workspace_id, me, p_user) and not on_common_board(b.workspace_id, me, p_user);
  if t is not null and rated >= 3 then t := 0.8 * t + 0.2 * r; end if;

  -- G: cosine of genre counts over finished and in-progress titles.
  with a as (select gg, count(*)::numeric c from visible_titles_for(me, p_user) x, jsonb_array_elements_text(x.genres) gg
             where not x.hidden and not on_common_board(x.workspace_id, me, p_user) and x.status in ('done', 'in_progress') group by gg),
       b as (select gg, count(*)::numeric c from visible_titles_for(p_user, me) x, jsonb_array_elements_text(x.genres) gg
             where not x.hidden and not on_common_board(x.workspace_id, me, p_user) and x.status in ('done', 'in_progress') group by gg),
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

drop function public.feed(timestamptz, int, text);
create function public.feed(p_before timestamptz default now(), p_limit int default 60, p_tz text default 'UTC')
returns table (actor_id uuid, actor_name text, kind text, title_id text, workspace_id uuid, title text, category text, cover text,
               count int, covers json, at timestamptz, on_shared_board boolean,
               rating int, title_ids text[])
language sql stable security definer set search_path = public as $$
with tz as materialized (
  select safe_tz(p_tz) as name
),
visible as (
  select e.id, e.actor_id, e.workspace_id, e.title_id, e.kind, e.payload, e.created_at,
         (e.created_at at time zone tz.name) as local_at,
         t.title as t_title, t.category as t_category, t.cover as t_cover, t.rating as t_rating, w.kind as w_kind
  from activity_events e
  cross join tz
  join profiles p on p.id = e.actor_id and p.share_activity
  join workspaces w on w.id = e.workspace_id
  join titles t on t.workspace_id = e.workspace_id and t.id = e.title_id and not t.hidden
  where auth.uid() is not null
    and e.created_at < p_before and e.created_at > now() - interval '14 days'
    and e.actor_id <> auth.uid()
    and ((w.visibility <> 'private' and are_friends(e.actor_id, auth.uid())) or is_member(e.workspace_id))
),
singles as (
  select v.actor_id, v.kind, v.title_id, v.workspace_id, v.t_title, v.t_category, v.t_cover, 1 as cnt, null::json as covers, v.created_at as at, v.w_kind,
         case when v.kind = 'completed' then v.t_rating end as rating, null::text[] as title_ids
  from visible v where v.kind in ('started', 'completed')
),
parts_day as (
  select v.actor_id, 'parts'::text as kind, v.title_id, v.workspace_id, max(v.t_title) as t_title, max(v.t_category) as t_category,
         max(v.t_cover) as t_cover, sum((v.payload->>'count')::int)::int as cnt, null::json as covers, max(v.created_at) as at, max(v.w_kind) as w_kind,
         null::int as rating, null::text[] as title_ids
  from visible v
  where v.kind = 'parts' and not exists (
    select 1 from visible c where c.kind = 'completed' and c.actor_id = v.actor_id and c.workspace_id = v.workspace_id
      and c.title_id = v.title_id and date_trunc('day', c.local_at) = date_trunc('day', v.local_at))
  group by v.actor_id, v.title_id, v.workspace_id, date_trunc('day', v.local_at)
),
added_hour as (
  select v.actor_id, 'added'::text as kind,
         (array_agg(v.title_id order by v.created_at desc))[1] as title_id,
         (array_agg(v.workspace_id order by v.created_at desc))[1] as workspace_id,
         (array_agg(v.t_title order by v.created_at desc))[1] as t_title,
         (array_agg(v.t_category order by v.created_at desc))[1] as t_category,
         (array_agg(v.t_cover order by v.created_at desc))[1] as t_cover,
         count(*)::int as cnt,
         json_agg(v.t_cover order by v.created_at desc) filter (where v.t_cover is not null) as covers,
         max(v.created_at) as at, max(v.w_kind) as w_kind,
         null::int as rating,
         array_agg(v.title_id order by v.created_at desc) filter (where v.t_cover is not null) as title_ids
  from visible v where v.kind = 'added'
  group by v.actor_id, date_trunc('hour', v.local_at)
),
lines as (select * from singles union all select * from parts_day union all select * from added_hour)
select l.actor_id, display_name_of(p), l.kind, l.title_id, l.workspace_id, l.t_title, l.t_category, l.t_cover, l.cnt, l.covers, l.at, l.w_kind = 'shared', l.rating, l.title_ids
from lines l join profiles p on p.id = l.actor_id
order by l.at desc
limit greatest(1, least(p_limit, 200));
$$;

do $$
declare f text;
begin
  foreach f in array array['public.feed(timestamptz,int,text)', 'public.friend_title(uuid,text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
