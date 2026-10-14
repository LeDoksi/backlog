-- apply_title_refresh(): the daily refresh's quiet write (spec 2.5).
begin;
select plan(15);
\ir support/social_fixture.sql
update public.workspaces set visibility = 'friends' where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'walking-dead', 'done', false, 'tmdb-series', '1402', 'series');
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'aot', 'queue', false, 'shikimori', '16498', 'anime');
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'aot-ova', 'done', false, 'shikimori', '25777', 'anime');
select pg_temp.put('00000000-0000-0000-0000-0000000000b2', 'theirs', 'queue', false, null, null, 'anime');

create temp table ev as select count(*) as n from public.activity_events;
grant select on ev to authenticated;
create function pg_temp.events() returns bigint language sql security definer as $$
  select (select count(*) from public.activity_events) - (select n from ev);
$$;

set local role authenticated;
-- Someone else's board: nothing changes.
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1',
  '[{"id":"walking-dead","base":{"parts":null,"checked_parts":{},"status":"done"},"parts":[{"name":"Сезон 1"}],"checked_parts":{"0":"2020-01-01T00:00:00Z"},"status":"done"}]',
  '[{"id":"aot-ova","base":{"parts":null,"checked_parts":{},"status":"done"}}]'), 0, 'a stranger changes nothing');
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select parts from public.titles where id = 'walking-dead'), null, 'the row is untouched');
select is((select count(*)::int from public.titles where id = 'aot-ova'), 1, 'and nothing is deleted');

-- Fill in the seasons of a finished show and merge the OVA into the main title.
select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1',
  '[{"id":"walking-dead","base":{"parts":null,"checked_parts":{},"status":"done"},
     "parts":[{"name":"Сезон 1","ref":"tmdb-season:1"},{"name":"Сезон 2","ref":"tmdb-season:2"}],
     "checked_parts":{"0":"2020-01-01T00:00:00Z","1":"2020-01-01T00:00:00Z"},"status":"done","manual_status":"done","airing_status":"completed"},
    {"id":"aot","base":{"parts":null,"checked_parts":{},"status":"queue"},
     "parts":[{"name":"Сезон 1","ref":"shiki:16498"},{"name":"OVA","ref":"shiki:25777","extra":true}],
     "checked_parts":{"1":"2020-01-01T00:00:00Z"},"status":"queue","manual_status":"queue","airing_status":"completed"}]',
  '[{"id":"aot-ova","base":{"parts":null,"checked_parts":{},"status":"done"}}]'), 3, 'two rows updated and one deleted');
select is(jsonb_array_length((select parts from public.titles where id = 'walking-dead')), 2, 'the seasons are written');
select is((select count(*)::int from public.titles where id = 'aot-ova'), 0, 'the duplicate is gone');
select is(pg_temp.events(), 0::bigint, 'no feed events from the quiet write');

-- The same call again (a second device): the base no longer matches, so nothing moves.
select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1',
  '[{"id":"walking-dead","base":{"parts":null,"checked_parts":{},"status":"done"},
     "parts":[{"name":"Сезон 1","ref":"tmdb-season:1"},{"name":"Сезон 2","ref":"tmdb-season:2"}],
     "checked_parts":{"0":"2020-01-01T00:00:00Z","1":"2020-01-01T00:00:00Z"},"status":"done"}]',
  '[{"id":"aot-ova","base":{"parts":null,"checked_parts":{},"status":"done"}}]'), -1, 'a stale call answers -1');
select is(jsonb_array_length((select parts from public.titles where id = 'walking-dead')), 2, 'and duplicates nothing');

-- An up-to-date call with the same content changes nothing and does not fail.
select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1',
  '[{"id":"walking-dead","base":{"parts":[{"name":"Сезон 1","ref":"tmdb-season:1"},{"name":"Сезон 2","ref":"tmdb-season:2"}],"checked_parts":{"0":"2020-01-01T00:00:00Z","1":"2020-01-01T00:00:00Z"},"status":"done"},
     "parts":[{"name":"Сезон 1","ref":"tmdb-season:1"},{"name":"Сезон 2","ref":"tmdb-season:2"}],
     "checked_parts":{"0":"2020-01-01T00:00:00Z","1":"2020-01-01T00:00:00Z"},"status":"done","manual_status":"done","airing_status":"completed"}]'), 0,
  'the same data again: 0 rows');

-- A new season: done -> in_progress, quietly.
select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1',
  '[{"id":"walking-dead","base":{"parts":[{"name":"Сезон 1","ref":"tmdb-season:1"},{"name":"Сезон 2","ref":"tmdb-season:2"}],"checked_parts":{"0":"2020-01-01T00:00:00Z","1":"2020-01-01T00:00:00Z"},"status":"done"},
     "parts":[{"name":"Сезон 1","ref":"tmdb-season:1"},{"name":"Сезон 2","ref":"tmdb-season:2"},{"name":"Сезон 3","ref":"tmdb-season:3"}],
     "checked_parts":{"0":"2020-01-01T00:00:00Z","1":"2020-01-01T00:00:00Z"},"status":"in_progress","manual_status":"done","airing_status":"completed"}]'), 1,
  'a new season is appended');
select is((select status from public.titles where id = 'walking-dead'), 'in_progress', 'the finished show is back in progress');
select is(pg_temp.events(), 0::bigint, 'still no feed events');

-- Outside the call the feed works as before.
update public.titles set status = 'done' where id = 'walking-dead';
select is(pg_temp.events(), 1::bigint, 'a normal edit after it is news again');

-- Rows of another board cannot be reached through mine.
select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1', '[]',
  '[{"id":"theirs","base":{"parts":null,"checked_parts":{},"status":"queue"}}]'), 0, 'deletes stay on my board');
select * from finish();
rollback;
