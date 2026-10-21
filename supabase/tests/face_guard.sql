-- BL-118: nobody edits a search card's face; a hand-made card only its
-- author (or anyone, when no author was recorded); the quiet refresh may.
begin;
select plan(16);
\ir support/social_fixture.sql
-- On the shared board ...b5 (me ...a1, mate ...a4): a search film, my
-- hand-made card, the mate's hand-made card, an old one with no author.
select pg_temp.put('00000000-0000-0000-0000-0000000000b5', 'dune', 'queue', false, 'tmdb-movie', '438631');
select pg_temp.put('00000000-0000-0000-0000-0000000000b5', 'mine');
select pg_temp.put('00000000-0000-0000-0000-0000000000b5', 'theirs');
select pg_temp.put('00000000-0000-0000-0000-0000000000b5', 'old');
update public.titles set created_by = '00000000-0000-0000-0000-0000000000a4' where id = 'theirs';
update public.titles set created_by = null where id = 'old';

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');

select throws_ok($$update public.titles set title = 'Дюна (моя)' where id = 'dune'$$, '42501', 'face_locked', 'a search card cannot be renamed');
select throws_ok($$update public.titles set cover = 'data:x', platforms = '["PC"]' where id = 'dune'$$, '42501', 'face_locked', 'nor get another cover');
select throws_ok($$update public.titles set category = 'series' where id = 'dune'$$, '42501', 'face_locked', 'nor another category');
select throws_ok($$update public.titles set source = null, source_id = null where id = 'dune'$$, '42501', 'face_locked', 'nor stop being a search card');
select lives_ok($$update public.titles set status = 'done', rating = 8, hidden = true, checked_parts = '{"0":"2026-10-21"}' where id = 'dune'$$, 'status, rating, hidden and ticks are mine');
select lives_ok($$update public.titles set title = title, cover = cover where id = 'dune'$$, 'the same values again (an undone delete) pass');

select lives_ok($$update public.titles set title = 'Моя карточка', synopsis = 'Текст' where id = 'mine'$$, 'my hand-made card is mine to edit');
select throws_ok($$update public.titles set title = 'Чужое' where id = 'theirs'$$, '42501', 'face_locked', 'the mate''s is not');
select lives_ok($$update public.titles set status = 'in_progress', rating = 5 where id = 'theirs'$$, 'but I mark it like any title');
select lives_ok($$delete from public.titles where id = 'theirs'$$, 'and may delete it from the board');
select lives_ok($$update public.titles set title = 'Старое' where id = 'old'$$, 'an old card with no author: anyone on the board');
select throws_ok($$update public.titles set created_by = '00000000-0000-0000-0000-0000000000a1' where id = 'old'$$, '42501', 'face_locked', 'nobody takes authorship');

-- The quiet refresh write.
select is(public.apply_title_refresh('00000000-0000-0000-0000-0000000000b5',
  '[{"id":"dune","base":{"parts":null,"checked_parts":{"0":"2026-10-21"},"status":"done","season_info":null},"title":"Дюна","season_info":null,"parts_manual":false}]'),
  1, 'the refresh renames a search card');
select is((select title from public.titles where id = 'dune'), 'Дюна', 'as its source has it');
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select throws_ok($$select public.apply_title_refresh('00000000-0000-0000-0000-0000000000b5',
  '[{"id":"mine","base":{"parts":null,"checked_parts":{},"status":"queue"},"title":"Взлом"}]')$$, '42501', 'face_locked', 'but does not open someone''s hand-made card');
select is((select title from public.titles where id = 'mine'), 'Моя карточка', 'which stays as its author left it');
select * from finish();
rollback;
