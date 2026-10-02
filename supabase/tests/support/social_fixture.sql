-- Shared cast for the social tests (included with \ir, inside the test's
-- transaction). Five people, each with a personal board:
--   me       ...a1  board ...b1, and the shared board ...b5 with mate
--   friend   ...a2  board ...b2, friends with me
--   stranger ...a3  board ...b3, nobody's friend
--   mate     ...a4  board ...b4, member of the shared board ...b5
--   other    ...a5  board ...b6, friends with me (a second friend)
-- Every board starts private, as in production. pg_temp.login(uid) sets
-- the caller for auth.uid() without changing role.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'me@test', '{}'),
  ('00000000-0000-0000-0000-0000000000a2', 'friend@test', '{}'),
  ('00000000-0000-0000-0000-0000000000a3', 'stranger@test', '{}'),
  ('00000000-0000-0000-0000-0000000000a4', 'mate@test', '{}'),
  ('00000000-0000-0000-0000-0000000000a5', 'other@test', '{}');
insert into public.workspaces (id, kind) values
  ('00000000-0000-0000-0000-0000000000b1', 'personal'),
  ('00000000-0000-0000-0000-0000000000b2', 'personal'),
  ('00000000-0000-0000-0000-0000000000b3', 'personal'),
  ('00000000-0000-0000-0000-0000000000b4', 'personal'),
  ('00000000-0000-0000-0000-0000000000b5', 'shared'),
  ('00000000-0000-0000-0000-0000000000b6', 'personal');
insert into public.profiles (id, email, display_name, nickname) values
  ('00000000-0000-0000-0000-0000000000a1', 'me@test', 'Я', 'me_user'),
  ('00000000-0000-0000-0000-0000000000a2', 'friend@test', 'Друг', 'friend_user'),
  ('00000000-0000-0000-0000-0000000000a3', 'stranger@test', null, 'stranger'),
  ('00000000-0000-0000-0000-0000000000a4', 'mate@test', 'Сосед', 'mate_user'),
  ('00000000-0000-0000-0000-0000000000a5', 'other@test', 'Другой', 'other_user');
insert into public.workspace_members (workspace_id, user_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000a4'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000a4'),
  ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000a5');
insert into public.friendships (user_a, user_b) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a5');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid)::text, true);
$$;
-- A title row with only what the tests care about. Inserted with an old
-- created_at so the activity trigger (a later migration) treats it as history
-- and the tests control which events exist.
create function pg_temp.put(ws uuid, tid text, st text default 'queue', hid boolean default false,
                             src text default null, sid text default null, cat text default 'movie', gen jsonb default '[]')
returns void language sql as $$
  insert into public.titles (workspace_id, id, title, category, status, hidden, source, source_id, genres, created_at, created_by)
  values (ws, tid, initcap(replace(tid, '-', ' ')), cat, st, hid, src, sid, gen, now() - interval '1 day',
          (select user_id from public.workspace_members where workspace_id = ws order by joined_at limit 1));
$$;
