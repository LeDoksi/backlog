-- taste_match and friend_shelf: over what each may see of the other.
begin;
select plan(15);
\ir support/social_fixture.sql
update public.workspaces set visibility = 'friends' where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b6');
-- Me and friend: the same five finished titles, the same genres, one shared want.
select pg_temp.put(b, 't' || i || '-2000', 'done', false, 'tmdb-movie', i::text, 'movie', '["драма","фэнтези"]')
from unnest(array['00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-0000000000b2']) b, generate_series(1, 5) i;
select pg_temp.put(b, 'want-2024', 'queue', false, 'tmdb-movie', '99')
from unnest(array['00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-0000000000b2']) b;
-- Other friend: five different titles and genres.
select pg_temp.put('00000000-0000-0000-0000-0000000000b6', 'o' || i || '-2001', 'done', false, 'tmdb-movie', (100 + i)::text, 'movie', '["ужасы"]')
from generate_series(1, 5) i;

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a2')->>'percent', '100', 'identical shelves: 100');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a2')->>'common', '5', 'five shared finished');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a2')->>'both_want', '1', 'one wanted by both');
select is((public.taste_match('00000000-0000-0000-0000-0000000000a2')->'genres')::jsonb, '["драма", "фэнтези"]'::jsonb, 'shared genres');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a5')->>'percent', '0', 'nothing in common: 0');
select is(public.taste_match('00000000-0000-0000-0000-0000000000a3')->>'status', 'not_enough', 'stranger''s board is private: too little to compare');
reset role;
update public.profiles set share_matches = false where id = '00000000-0000-0000-0000-0000000000a3';
set local role authenticated;
select is(public.taste_match('00000000-0000-0000-0000-0000000000a3')->>'status', 'not_enough', 'a stranger''s switch is not told');
reset role;
update public.profiles set share_matches = true where id = '00000000-0000-0000-0000-0000000000a3';
set local role authenticated;

-- Hidden titles do not count: hide one of the friend's finished ones.
reset role;
update public.titles set hidden = true where workspace_id = '00000000-0000-0000-0000-0000000000b2' and id = 't1-2000';
set local role authenticated;
select is(public.taste_match('00000000-0000-0000-0000-0000000000a2')->>'common', '4', 'hidden titles are left out');
reset role;
update public.titles set hidden = true where workspace_id = '00000000-0000-0000-0000-0000000000b2' and id = 't2-2000';
set local role authenticated;
select is(public.taste_match('00000000-0000-0000-0000-0000000000a2')->>'status', 'not_enough', 'fewer than five visible: not enough');

reset role;
update public.profiles set share_matches = false where id = '00000000-0000-0000-0000-0000000000a5';
set local role authenticated;
select is(public.taste_match('00000000-0000-0000-0000-0000000000a5')->>'status', 'disabled', 'their matches switched off');
reset role;
update public.profiles set share_matches = true where id = '00000000-0000-0000-0000-0000000000a5';
update public.profiles set share_matches = false where id = '00000000-0000-0000-0000-0000000000a1';
set local role authenticated;
select is(public.taste_match('00000000-0000-0000-0000-0000000000a5')->>'status', 'disabled', 'mine switched off');

-- Shelf: tabs, "common", hidden and private left out.
select results_eq($$select id, common from public.friend_shelf('00000000-0000-0000-0000-0000000000a2', 'done') order by id$$,
  $$values ('t3-2000'::text, true), ('t4-2000'::text, true), ('t5-2000'::text, true)$$, 'finished shelf without hidden, marked common');
select results_eq($$select id from public.friend_shelf('00000000-0000-0000-0000-0000000000a2', 'want')$$, $$values ('want-2024'::text)$$, 'want tab');
select is((select count(*)::int from public.friend_shelf('00000000-0000-0000-0000-0000000000a3', 'done')), 0, 'private shelf is empty');
select is(public.friend_profile('00000000-0000-0000-0000-0000000000a3')::text, null, 'no page for a stranger with nothing open');
select * from finish();
rollback;
