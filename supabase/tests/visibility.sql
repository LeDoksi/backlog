-- visible_titles(owner) is the only privacy check of the social features:
-- owner and board members see everything, friends see 'friends' and
-- 'everyone' boards, anyone sees 'everyone', hidden titles only insiders.
begin;
select plan(16);
\ir support/social_fixture.sql

select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'drive-2011', 'done', false, 'tmdb-movie', '64690');
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'secret-2020', 'queue', true);
select pg_temp.put('00000000-0000-0000-0000-0000000000b5', 'drive-2011', 'queue', false, 'tmdb-movie', '64690');
select pg_temp.put('00000000-0000-0000-0000-0000000000b5', 'frieren-2023', 'in_progress', false, 'shikimori', '52991', 'anime');
select pg_temp.put('00000000-0000-0000-0000-0000000000b5', 'shared-secret-2021', 'queue', true);

create function pg_temp.seen(viewer uuid) returns text language sql as $$
  select pg_temp.login(viewer);
  select coalesce(string_agg(workspace_id::text || '/' || id, ',' order by id), '')
  from public.visible_titles('00000000-0000-0000-0000-0000000000a1');
$$;
-- Short names for the board/title pairs.
create function pg_temp.ids(t text) returns text language sql as $$
  select replace(replace(t, '00000000-0000-0000-0000-0000000000b1', 'mine'), '00000000-0000-0000-0000-0000000000b5', 'ours');
$$;

select is(pg_temp.ids(pg_temp.seen('00000000-0000-0000-0000-0000000000a1')),
  'mine/drive-2011,ours/frieren-2023,mine/secret-2020,ours/shared-secret-2021',
  'owner sees everything once, hidden included, personal copy preferred');
select is(pg_temp.ids(pg_temp.seen('00000000-0000-0000-0000-0000000000a4')),
  'ours/drive-2011,ours/frieren-2023,ours/shared-secret-2021',
  'board mate sees the whole shared board, not the private personal one');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a2'), '', 'friend sees nothing while everything is private');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a3'), '', 'stranger sees nothing while everything is private');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a5'), '', 'second friend sees nothing either');

update public.workspaces set visibility = 'friends' where id = '00000000-0000-0000-0000-0000000000b1';
select is(pg_temp.ids(pg_temp.seen('00000000-0000-0000-0000-0000000000a2')), 'mine/drive-2011', 'friend sees a friends board without hidden');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a3'), '', 'stranger does not see a friends board');
select is(pg_temp.ids(pg_temp.seen('00000000-0000-0000-0000-0000000000a4')),
  'ours/drive-2011,ours/frieren-2023,ours/shared-secret-2021', 'mate is not my friend: personal friends board stays closed');

update public.workspaces set visibility = 'everyone' where id = '00000000-0000-0000-0000-0000000000b1';
select is(pg_temp.ids(pg_temp.seen('00000000-0000-0000-0000-0000000000a3')), 'mine/drive-2011', 'stranger sees an everyone board without hidden');
select is(pg_temp.ids(pg_temp.seen('00000000-0000-0000-0000-0000000000a4')),
  'mine/drive-2011,ours/frieren-2023,ours/shared-secret-2021', 'mate: an opened personal board adds its copy, its hidden title stays out');

update public.workspaces set visibility = 'private' where id = '00000000-0000-0000-0000-0000000000b1';
update public.workspaces set visibility = 'friends' where id = '00000000-0000-0000-0000-0000000000b5';
select is(pg_temp.ids(pg_temp.seen('00000000-0000-0000-0000-0000000000a2')), 'ours/drive-2011,ours/frieren-2023',
  'friend sees the shared board opened to friends, without its hidden title');
select is(pg_temp.seen('00000000-0000-0000-0000-0000000000a3'), '', 'stranger does not');

-- Nobody signed in sees nothing, even of an everyone board.
update public.workspaces set visibility = 'everyone' where id = '00000000-0000-0000-0000-0000000000b5';
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.visible_titles('00000000-0000-0000-0000-0000000000a1')), 0, 'no caller, no titles');

select is(public.title_key('tmdb-movie', '1', 'x-2000'), 'tmdb-movie:1', 'key prefers the source id');
select is(public.title_key(null, null, 'x-2000'), 'slug:x-2000', 'key falls back to the slug');
select ok(not has_function_privilege('authenticated', 'public.visible_titles(uuid)', 'execute'), 'visible_titles is not an RPC');
select * from finish();
rollback;
