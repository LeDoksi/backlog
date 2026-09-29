-- Review fixes: one malformed stored value must not block writes or the
-- leaderboard.
begin;
select plan(2);
\ir support/social_fixture.sql
update public.workspaces set visibility = 'friends' where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set in_leaderboard = true where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.put('00000000-0000-0000-0000-0000000000b1', 'odd', 'queue', false, null, null, 'anime');
update public.titles set checked_parts = '[]'::jsonb where id = 'odd';
select lives_ok($$update public.titles set status = 'in_progress' where id = 'odd'$$, 'a checklist that is not an object does not block edits');
update public.titles set checked_parts = '{"0": "2026-02-30T00:00:00Z", "1": "вчера"}'::jsonb where id = 'odd';
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.leaderboard('anime', 'month')$$, 'a tick with a bad date does not break the leaderboard');
select * from finish();
rollback;
