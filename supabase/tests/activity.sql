-- Which title changes become events. Nothing on a private board, nothing
-- for a hidden title, nothing for going back or for plain edits.
begin;
select plan(12);
\ir support/social_fixture.sql
-- Security definer: activity_events has no read policy for signed-in users.
create function pg_temp.events() returns text language sql security definer as $$
  select coalesce(string_agg(kind || coalesce(':' || (payload->>'count'), ''), ',' order by id), '') from public.activity_events;
$$;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into public.titles (workspace_id, id, title, category) values ('00000000-0000-0000-0000-0000000000b1', 'p-2000', 'P', 'movie');
update public.titles set status = 'in_progress' where id = 'p-2000';
update public.titles set status = 'done' where id = 'p-2000';
reset role;
select is(pg_temp.events(), '', 'private board: no events at all');

-- Opening the board later does not bring back what happened before.
update public.workspaces set visibility = 'friends' where id = '00000000-0000-0000-0000-0000000000b1';
select is(pg_temp.events(), '', 'opening the board surfaces nothing from before');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into public.titles (workspace_id, id, title, category) values ('00000000-0000-0000-0000-0000000000b1', 'q-2001', 'Q', 'series');
select is(pg_temp.events(), 'added', 'adding on an open board');
update public.titles set status = 'in_progress' where id = 'q-2001';
select is(pg_temp.events(), 'added,started', 'queue to in progress is a start');
update public.titles set status = 'queue' where id = 'q-2001';
update public.titles set status = 'in_progress' where id = 'q-2001';
select is(pg_temp.events(), 'added,started,started', 'a step back is silent, going forward again counts');
update public.titles set title = 'Q2', synopsis = 'x' where id = 'q-2001';
select is(pg_temp.events(), 'added,started,started', 'plain edits are silent');
update public.titles set checked_parts = '{"0":"2026-10-01T00:00:00Z","1":"2026-10-01T00:00:00Z"}' where id = 'q-2001';
select is(pg_temp.events(), 'added,started,started,parts:2', 'two new ticks are one event with a count');
update public.titles set checked_parts = '{"1":"2026-10-01T00:00:00Z"}' where id = 'q-2001';
select is(pg_temp.events(), 'added,started,started,parts:2', 'unticking is silent');
update public.titles set status = 'done' where id = 'q-2001';
select is(pg_temp.events(), 'added,started,started,parts:2,completed', 'finishing');
reset role;
select is((select actor_id from public.activity_events order by id desc limit 1), '00000000-0000-0000-0000-0000000000a1'::uuid, 'the actor is the caller');

set local role authenticated;
update public.titles set hidden = true where id = 'q-2001';
update public.titles set status = 'queue' where id = 'q-2001';
update public.titles set status = 'done' where id = 'q-2001';
select is(pg_temp.events(), 'added,started,started,parts:2,completed', 'hidden title: silent');

-- A backdated insert (moving titles over) is history, not news.
insert into public.titles (workspace_id, id, title, category, created_at) values ('00000000-0000-0000-0000-0000000000b1', 'old-1999', 'O', 'movie', now() - interval '2 days');
select is(pg_temp.events(), 'added,started,started,parts:2,completed', 'backdated insert is silent');
select * from finish();
rollback;
