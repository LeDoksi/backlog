-- friend_title(): one title of someone else's shelf, only through visible_titles_for.
begin;
select plan(10);
\ir support/social_fixture.sql
select pg_temp.put('00000000-0000-0000-0000-0000000000b2', 'drive', 'done', false, 'tmdb-movie', '64690');
select pg_temp.put('00000000-0000-0000-0000-0000000000b2', 'secret', 'queue', true);
update public.titles set rating = 9, synopsis = 'Водитель', parts = '[{"name":"Сезон 1"},{"name":"Сезон 2"}]', checked_parts = '{"0":"2026-10-01T00:00:00Z"}'
 where workspace_id = '00000000-0000-0000-0000-0000000000b2' and id = 'drive';
-- I have the same film on my board under another id.
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'drive-2011', 'queue', false, 'tmdb-movie', '64690');

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select ok(public.friend_title('00000000-0000-0000-0000-0000000000a2', 'drive') is null, 'friend''s private board: nothing');
reset role;
update public.workspaces set visibility = 'friends' where id = '00000000-0000-0000-0000-0000000000b2';
set local role authenticated;
select is(public.friend_title('00000000-0000-0000-0000-0000000000a2', 'drive')->>'title', 'Drive', 'friends board: a friend sees the title');
select is((public.friend_title('00000000-0000-0000-0000-0000000000a2', 'drive')->>'rating')::int, 9, 'with the rating');
select is((public.friend_title('00000000-0000-0000-0000-0000000000a2', 'drive')->'checked')::jsonb, '[0]'::jsonb, 'and the ticked parts as indexes');
select is(public.friend_title('00000000-0000-0000-0000-0000000000a2', 'drive')->>'mine_id', 'drive-2011', 'my copy of the same title is found');
select ok(public.friend_title('00000000-0000-0000-0000-0000000000a2', 'secret') is null, 'a hidden title is not shown');
select ok(public.friend_title('00000000-0000-0000-0000-0000000000a2', 'drive')::text !~ '@', 'no email anywhere');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select ok(public.friend_title('00000000-0000-0000-0000-0000000000a2', 'drive') is null, 'a stranger does not see a friends board');
reset role;
update public.workspaces set visibility = 'everyone' where id = '00000000-0000-0000-0000-0000000000b2';
set local role authenticated;
select is(public.friend_title('00000000-0000-0000-0000-0000000000a2', 'drive')->>'mine_id', null, 'everyone board: a stranger sees it, nothing of theirs matches');
select is(public.friend_title('00000000-0000-0000-0000-0000000000a2', 'drive')->>'status', 'done', 'with the status');
select * from finish();
rollback;
