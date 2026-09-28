-- Status dates follow status changes; migrated rows keep unknown dates unknown.
begin;
select plan(8);
insert into public.workspaces (id, kind) values ('10000000-0000-0000-0000-000000000001', 'personal');
insert into public.titles (workspace_id, id, title, category, status) values
  ('10000000-0000-0000-0000-000000000001', 'fresh-done', 'Fresh', 'movie', 'done');
select isnt((select completed_at from public.titles where id = 'fresh-done'), null, 'new done title gets completed_at');
insert into public.titles (workspace_id, id, title, category, status, created_at) values
  ('10000000-0000-0000-0000-000000000001', 'old-done', 'Old', 'movie', 'done', '2026-01-01');
select is((select completed_at from public.titles where id = 'old-done'), null, 'migrated done title keeps completed_at empty');
update public.titles set status = 'queue' where id = 'fresh-done';
select is((select completed_at from public.titles where id = 'fresh-done'), null, 'leaving done clears completed_at');
insert into public.titles (workspace_id, id, title, category, status, updated_at) values
  ('10000000-0000-0000-0000-000000000001', 'show', 'Show', 'series', 'queue', '2020-01-01');
select isnt((select updated_at from public.titles where id = 'show'), '2020-01-01'::timestamptz, 'insert stamps updated_at');
update public.titles set status = 'in_progress', started_at = null where id = 'show';
select isnt((select started_at from public.titles where id = 'show'), null, 'queue -> in_progress sets started_at');
update public.titles set started_at = '2026-02-02' where id = 'show';
update public.titles set status = 'queue' where id = 'show';
update public.titles set status = 'in_progress' where id = 'show';
select is((select started_at from public.titles where id = 'show'), '2026-02-02'::timestamptz, 'second entry into in_progress keeps started_at');
update public.titles set title = 'Show!' where id = 'old-done';
select is((select completed_at from public.titles where id = 'old-done'), null, 'editing a field does not date a migrated done title');
update public.titles set status = 'done' where id = 'show';
select isnt((select completed_at from public.titles where id = 'show'), null, 'in_progress -> done sets completed_at');
select * from finish();
rollback;
