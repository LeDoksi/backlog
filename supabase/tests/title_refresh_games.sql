-- apply_title_refresh() with card fields (wave 3: game covers, descriptions,
-- the one-time normalization).
begin;
select plan(9);
\ir support/social_fixture.sql
update public.workspaces set visibility = 'friends' where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'hogwarts', 'queue', false, 'steam', '990080', 'game');
update public.titles set cover = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/990080/header.jpg',
  synopsis = 'Hogwarts Legacy is an immersive RPG.' where id = 'hogwarts';

create temp table ev as select count(*) as n from public.activity_events;
grant select on ev to authenticated;
create function pg_temp.events() returns bigint language sql security definer as $$
  select (select count(*) from public.activity_events) - (select n from ev);
$$;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1',
  '[{"id":"hogwarts","base":{"parts":null,"checked_parts":{},"status":"queue","cover":"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/990080/header.jpg","synopsis":"Hogwarts Legacy is an immersive RPG."},
     "cover":"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/990080/library_600x900.jpg","synopsis":"[mt] Ролевая игра.","genres":["Ролевые игры"],"year":2023,"original_title":"Hogwarts Legacy"}]'),
  1, 'the card fields are written');
select is((select cover from public.titles where id = 'hogwarts'), 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/990080/library_600x900.jpg', 'tall cover');
select is((select synopsis || '|' || genres::text || '|' || year || '|' || original_title from public.titles where id = 'hogwarts'),
  '[mt] Ролевая игра.|["Ролевые игры"]|2023|Hogwarts Legacy', 'description, genres, year, original title');
select is((select status from public.titles where id = 'hogwarts'), 'queue', 'the status is untouched');
select is(pg_temp.events(), 0::bigint, 'no feed events');

-- Someone renamed it meanwhile: a base naming the old title is stale.
update public.titles set title = 'Хогвартс' where id = 'hogwarts';
select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1',
  '[{"id":"hogwarts","base":{"parts":null,"checked_parts":{},"status":"queue","title":"Hogwarts"},"title":"Hogwarts Legacy"}]'),
  -1, 'a changed field makes the call stale');
select is((select title from public.titles where id = 'hogwarts'), 'Хогвартс', 'and the rename stays');

-- An empty title is never written; the same data again changes nothing.
select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1',
  '[{"id":"hogwarts","base":{"parts":null,"checked_parts":{},"status":"queue","title":"Хогвартс"},"title":"  "}]'),
  0, 'an empty title changes nothing');
select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b1',
  '[{"id":"hogwarts","base":{"parts":null,"checked_parts":{},"status":"queue"},"year":2023,"genres":["Ролевые игры"]}]'),
  0, 'the same values again: 0 rows');
select * from finish();
rollback;
