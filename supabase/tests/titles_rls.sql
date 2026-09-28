-- A member reads and writes the titles of their own boards and nothing else.
begin;
select plan(7);
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test');
insert into public.workspaces (id, kind) values
  ('10000000-0000-0000-0000-000000000001', 'personal'),
  ('10000000-0000-0000-0000-000000000002', 'personal');
insert into public.workspace_members (workspace_id, user_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b');
insert into public.titles (workspace_id, id, title, category) values
  ('10000000-0000-0000-0000-000000000001', 'mine-2020', 'Mine', 'movie'),
  ('10000000-0000-0000-0000-000000000002', 'theirs-2020', 'Theirs', 'movie');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select results_eq($$select id from public.titles$$, $$values ('mine-2020')$$, 'sees only titles of own boards');
select results_eq($$select id::text from public.workspaces$$, $$values ('10000000-0000-0000-0000-000000000001')$$, 'sees only own boards');
select lives_ok($$insert into public.titles (workspace_id, id, title, category) values ('10000000-0000-0000-0000-000000000001', 'new-2021', 'New', 'game')$$, 'inserts into own board');
select throws_like($$insert into public.titles (workspace_id, id, title, category) values ('10000000-0000-0000-0000-000000000002', 'x-2021', 'X', 'game')$$, '%row-level security%', 'cannot insert into a foreign board');
update public.titles set title = 'Hacked' where id = 'theirs-2020';
delete from public.titles where id = 'theirs-2020';
reset role;
select is((select title from public.titles where id = 'theirs-2020'), 'Theirs', 'foreign title neither updated nor deleted');
select is((select created_by::text from public.titles where id = 'new-2021'), '00000000-0000-0000-0000-00000000000a', 'created_by defaults to the caller');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select throws_like($$update public.titles set workspace_id = '10000000-0000-0000-0000-000000000002' where id = 'mine-2020'$$, '%row-level security%', 'cannot move a title into a foreign board');
select * from finish();
rollback;
