-- feed(): what a viewer sees of others' events, and how lines merge.
begin;
select plan(17);
\ir support/social_fixture.sql
update public.workspaces set visibility = 'friends' where id in ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b3');
select pg_temp.put('00000000-0000-0000-0000-0000000000b2', 'fr-2020', 'in_progress', false, null, null, 'anime');
select pg_temp.put('00000000-0000-0000-0000-0000000000b2', 'done-2020', 'done');
select pg_temp.put('00000000-0000-0000-0000-0000000000b3', 'st-2020', 'done');
select pg_temp.put('00000000-0000-0000-0000-0000000000b5', 'sh-2020', 'done');
-- Events written directly: the trigger is covered by activity.sql; here the
-- times matter. Friend: 3 tick events today on one title, a completion
-- today of another title that also had ticks today, 12 additions in one hour.
create function pg_temp.ev(actor uuid, ws uuid, tid text, k text, ago interval, n int default null) returns void language sql as $$
  insert into public.activity_events (actor_id, workspace_id, title_id, kind, payload, created_at)
  values (actor, ws, tid, k, case when n is null then '{}'::jsonb else jsonb_build_object('count', n) end, now() - ago);
$$;
select pg_temp.ev('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2', 'fr-2020', 'parts', '3 minutes', 1);
select pg_temp.ev('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2', 'fr-2020', 'parts', '2 minutes', 1);
select pg_temp.ev('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2', 'fr-2020', 'parts', '1 minute', 1);
select pg_temp.ev('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2', 'done-2020', 'parts', '4 minutes', 2);
select pg_temp.ev('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2', 'done-2020', 'completed', '4 minutes');
select pg_temp.ev('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000b3', 'st-2020', 'completed', '5 minutes');
select pg_temp.ev('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000b5', 'sh-2020', 'completed', '6 minutes');
select pg_temp.ev('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2', 'old-2020', 'completed', '15 days');
insert into public.titles (workspace_id, id, title, category, cover, created_at)
select '00000000-0000-0000-0000-0000000000b2', 'add-' || i, 'Add ' || i, 'movie', 'c' || i || '.jpg', now() - interval '1 day' from generate_series(1, 12) i;
-- The hour is the viewer's: pin the twelve additions inside one hour of UTC.
insert into public.activity_events (actor_id, workspace_id, title_id, kind, created_at)
select '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b2', 'add-' || i, 'added',
       date_trunc('hour', now() - interval '2 hours') + (i || ' minutes')::interval from generate_series(1, 12) i;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
create temp table f as select * from public.feed(now(), 60, 'UTC');
select is((select count(*)::int from f where kind = 'parts' and title_id = 'fr-2020'), 1, 'three ticks of one title in a day are one line');
select is((select count from f where kind = 'parts' and title_id = 'fr-2020'), 3, 'with their total');
select is((select count(*)::int from f where title_id = 'done-2020'), 1, 'on the day it was finished only the completion shows');
select is((select kind from f where title_id = 'done-2020'), 'completed', 'and it is the completion');
select is((select count(*)::int from f where kind = 'added'), 1, 'twelve additions in an hour are one line');
select is((select count from f where kind = 'added'), 12, 'counting twelve');
select is((select json_array_length(covers) from f where kind = 'added'), 12, 'with every cover');
select is((select count(*)::int from f where actor_id = '00000000-0000-0000-0000-0000000000a3'), 0, 'a stranger''s friends board is not in my feed');
select is((select on_shared_board from f where actor_id = '00000000-0000-0000-0000-0000000000a4'), true, 'a board mate''s event on our board is, marked shared');
select is((select count(*)::int from f where title_id = 'old-2020'), 0, 'older than 14 days is gone');
select is((select actor_name from f where actor_id = '00000000-0000-0000-0000-0000000000a2' limit 1), 'Друг', 'name, no email');

reset role;
update public.profiles set share_activity = false where id = '00000000-0000-0000-0000-0000000000a2';
set local role authenticated;
select is((select count(*)::int from public.feed() where actor_id = '00000000-0000-0000-0000-0000000000a2'), 0, 'activity switched off hides everything');
reset role;
update public.profiles set share_activity = true where id = '00000000-0000-0000-0000-0000000000a2';
update public.titles set hidden = true where id = 'fr-2020';
set local role authenticated;
select is((select count(*)::int from public.feed() where title_id = 'fr-2020'), 0, 'hiding a title takes its lines back');
-- Time zone: a real one is kept, anything else falls back to UTC.
reset role;
select is(array[public.safe_tz('Europe/Moscow'), public.safe_tz('Mars/Base'), public.safe_tz(null), public.safe_tz('UTC+3'), public.safe_tz('MSK')], array['Europe/Moscow', 'UTC', 'UTC', 'UTC', 'UTC'], 'safe_tz keeps real zone names only');
set local role authenticated;
select is((select count(*)::int from public.feed(now(), 60, 'Mars/Base')), (select count(*)::int from public.feed(now(), 60, 'UTC')), 'an unknown zone reads as UTC');
select lives_ok($$select * from public.feed(now(), 60, null)$$, 'no zone at all is fine');
-- Badge: every line is new before the first visit, none after.
select public.mark_feed_seen();
select is(public.badge_count(), 0, 'after opening the tab the badge is empty');
select * from finish();
rollback;
