-- «Что нового»: the read mark is per person, only moves forward, never past
-- now, and a person who signs up later starts with everything read.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'old@test'),
  ('00000000-0000-0000-0000-0000000000e2', 'other@test'),
  ('00000000-0000-0000-0000-0000000000e3', 'new@test');
-- Profiles from before the migration have no mark.
insert into public.profiles (id, email, whats_new_seen_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'old@test', null),
  ('00000000-0000-0000-0000-0000000000e2', 'other@test', null);
insert into public.allowed_emails (email, invited_by, expires_at) values ('new@test', null, now() + interval '30 days');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1"}';
select is(public.my_profile()->>'whats_new_seen_at', null, 'someone already here has seen nothing yet');
select lives_ok($$select public.mark_whats_new_seen('2026-10-21T00:00:00Z')$$, 'opening the list marks it');
select is((public.my_profile()->>'whats_new_seen_at')::timestamptz, '2026-10-21T00:00:00Z'::timestamptz, 'the mark is the newest entry seen');
select public.mark_whats_new_seen('2026-10-01T00:00:00Z');
select is((public.my_profile()->>'whats_new_seen_at')::timestamptz, '2026-10-21T00:00:00Z'::timestamptz, 'an older copy of the app does not move it back');
select public.mark_whats_new_seen('2999-01-01T00:00:00Z');
select ok((public.my_profile()->>'whats_new_seen_at')::timestamptz <= now(), 'a date in the future is cut to now');
select public.mark_whats_new_seen(null);
select ok(public.my_profile()->>'whats_new_seen_at' is not null, 'no date changes nothing');
reset role;
select is((select whats_new_seen_at from public.profiles where id = '00000000-0000-0000-0000-0000000000e2'), null, 'another person''s mark is untouched');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e3"}';
select is(public.complete_signup()->>'status', 'created', 'a new person signs up');
select ok((public.my_profile()->>'whats_new_seen_at')::timestamptz >= now() - interval '1 minute', 'and starts with everything read');
reset role;

select * from finish();
rollback;
