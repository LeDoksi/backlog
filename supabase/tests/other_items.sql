-- «Другое» (BL-119): lines only for members of the board, the author edits
-- the text, anyone on the board changes status and rating, fields are
-- checked, a category follows the spelling already on the board, and
-- nothing leaks into the feed, the leaderboard or friends' shelves.
begin;
select plan(31);
\ir support/social_fixture.sql
update public.workspaces set visibility = 'everyone';
update public.profiles set in_leaderboard = true;

create temp table ev as select count(*) as n from public.activity_events;
grant select on ev to authenticated;
create function pg_temp.events() returns bigint language sql security definer as $$
  select (select count(*) from public.activity_events) - (select n from ev);
$$;
create function pg_temp.items() returns setof public.other_items language sql security definer as $$ select * from public.other_items $$;
create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

-- The switch.
select is(public.my_profile()->>'show_other', 'false', 'the tab is off by default');
select public.set_show_other(true);
select is(public.my_profile()->>'show_other', 'true', 'and can be switched on');

-- Adding.
insert into ids select 'book', (public.save_other_item('00000000-0000-0000-0000-0000000000b1',
  '{"title":"  Дюна ","category":"Книги","description":"Херберт","links":["https://example.com/dune"]}')->>'id')::uuid;
select is((select title || '|' || category || '|' || status from pg_temp.items() where id = (select id from ids where name = 'book')),
  'Дюна|Книги|want', 'a line is added trimmed, as «Хочу»');
select is((select created_by from pg_temp.items() where id = (select id from ids where name = 'book')),
  '00000000-0000-0000-0000-0000000000a1'::uuid, 'the caller is its author');
select is(json_array_length(public.other_items('00000000-0000-0000-0000-0000000000b1')), 1, 'the board lists it');
select is(public.other_items('00000000-0000-0000-0000-0000000000b1')->0->>'mine', 'true', 'as mine');
select is((public.save_other_item('00000000-0000-0000-0000-0000000000b1', '{"title":"Сапиенс","category":"книги "}')->>'category'),
  'Книги', 'another spelling of a category joins the existing one');
select is((public.save_other_item('00000000-0000-0000-0000-0000000000b1', '{"title":"Пушкин","category":"Рестораны","status":"done","rating":9}')->>'rating'),
  '9', 'status and rating are kept');

-- Checks.
select throws_ok($$select public.save_other_item('00000000-0000-0000-0000-0000000000b1', '{"title":"  ","category":"Книги"}')$$, 'P0001', 'bad_title', 'a title is required');
select throws_ok($$select public.save_other_item('00000000-0000-0000-0000-0000000000b1', jsonb_build_object('title', repeat('a', 201), 'category', 'Книги'))$$, 'P0001', 'bad_title', 'a title is at most 200');
select throws_ok($$select public.save_other_item('00000000-0000-0000-0000-0000000000b1', '{"title":"x","category":""}')$$, 'P0001', 'bad_category', 'a category is required');
select throws_ok($$select public.save_other_item('00000000-0000-0000-0000-0000000000b1', jsonb_build_object('title', 'x', 'category', repeat('a', 41)))$$, 'P0001', 'bad_category', 'a category is at most 40');
select throws_ok($$select public.save_other_item('00000000-0000-0000-0000-0000000000b1', jsonb_build_object('title', 'x', 'category', 'a', 'description', repeat('a', 2001)))$$, 'P0001', 'bad_description', 'a description is at most 2000');
select throws_ok($$select public.save_other_item('00000000-0000-0000-0000-0000000000b1', '{"title":"x","category":"a","links":["javascript:alert(1)"]}')$$, 'P0001', 'bad_links', 'only http(s) links');
select throws_ok($$select public.save_other_item('00000000-0000-0000-0000-0000000000b1', '{"title":"x","category":"a","links":["https://a.ru","https://b.ru","https://c.ru","https://d.ru"]}')$$, 'P0001', 'bad_links', 'at most three links');
select throws_ok($$select public.save_other_item('00000000-0000-0000-0000-0000000000b1', '{"title":"x","category":"a","status":"in_progress"}')$$, 'P0001', 'bad_status', 'only «Хочу» and «Готово»');
select throws_ok($$select public.save_other_item('00000000-0000-0000-0000-0000000000b1', '{"title":"x","category":"a","rating":11}')$$, 'P0001', 'bad_rating', 'a rating is 1 to 10');

-- Strangers.
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select throws_ok($$select public.other_items('00000000-0000-0000-0000-0000000000b1')$$, 'P0001', 'not_member', 'a stranger cannot read a board');
select throws_ok($$select public.save_other_item('00000000-0000-0000-0000-0000000000b1', '{"title":"x","category":"a"}')$$, 'P0001', 'not_member', 'nor add to it');
select throws_ok($$select public.save_other_item('00000000-0000-0000-0000-0000000000b3', jsonb_build_object('id', (select id from ids where name = 'book'), 'title', 'x', 'category', 'a'))$$, 'P0001', 'not_found', 'nor reach a line through their own board');
select throws_ok($$select public.delete_other_item('00000000-0000-0000-0000-0000000000b1', (select id from ids where name = 'book'))$$, 'P0001', 'not_member', 'nor delete');
select ok(not has_table_privilege('authenticated', 'public.other_items', 'select'), 'the table itself is closed');

-- A shared board: the mate changes status and rating, not the text.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
insert into ids select 'play', (public.save_other_item('00000000-0000-0000-0000-0000000000b5', '{"title":"Гамлет","category":"Театр"}')->>'id')::uuid;
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is(public.other_items('00000000-0000-0000-0000-0000000000b5')->0->>'mine', 'false', 'the mate sees the line, not as theirs');
select is((public.save_other_item('00000000-0000-0000-0000-0000000000b5',
  jsonb_build_object('id', (select id from ids where name = 'play'), 'title', 'Гамлет', 'category', 'Театр', 'status', 'done', 'rating', 8))->>'status'),
  'done', 'the mate marks it «Готово»');
select throws_ok($$select public.save_other_item('00000000-0000-0000-0000-0000000000b5',
  jsonb_build_object('id', (select id from ids where name = 'play'), 'title', 'Отелло', 'category', 'Театр'))$$, 'P0001', 'not_author', 'but cannot rename it');
select throws_ok($$select public.delete_other_item('00000000-0000-0000-0000-0000000000b5', (select id from ids where name = 'play'))$$, 'P0001', 'not_author', 'nor delete it');

-- Nothing reaches friends: no events, no leaderboard, nothing on a shelf.
select is(pg_temp.events(), 0::bigint, 'no feed events');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.friend_shelf('00000000-0000-0000-0000-0000000000a1', 'done')), 0, 'a friend''s shelf shows nothing');

-- Undo after delete: the line comes back with its id and date.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
create temp table gone as select * from pg_temp.items() where id = (select id from ids where name = 'book');
select public.delete_other_item('00000000-0000-0000-0000-0000000000b1', (select id from ids where name = 'book'));
select is((select count(*)::int from pg_temp.items() where id = (select id from ids where name = 'book')), 0, 'the author deletes');
select is((public.save_other_item('00000000-0000-0000-0000-0000000000b1',
  (select jsonb_build_object('id', id, 'title', title, 'category', category, 'description', description, 'links', links, 'created_at', created_at) from gone))->>'created_at')::timestamptz,
  (select created_at from gone), '«Отменить» brings it back under the old date');

-- The board goes, its lines go.
reset role;
delete from public.workspaces where id = '00000000-0000-0000-0000-0000000000b1';
select is((select count(*)::int from pg_temp.items() where workspace_id = '00000000-0000-0000-0000-0000000000b1'), 0, 'deleting a board deletes its lines');

select * from finish();
rollback;
