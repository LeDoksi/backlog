-- Requests, counter-requests, accepting, removing, search and the friend list.
begin;
select plan(18);
\ir support/social_fixture.sql
update public.profiles set findable_by_nick = false where id = '00000000-0000-0000-0000-0000000000a4';

set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select is(public.send_friend_request('00000000-0000-0000-0000-0000000000a4')->>'status', 'requested', 'stranger asks mate');
select is(public.send_friend_request('00000000-0000-0000-0000-0000000000a4')->>'status', 'requested', 'asking twice is harmless');
select is(public.send_friend_request('00000000-0000-0000-0000-0000000000a3')->>'status', 'self', 'cannot befriend yourself');
select is(public.send_friend_request('00000000-0000-0000-0000-0000000000ff')->>'status', 'not_found', 'unknown person');
select is((select requested from public.search_users('mat') where nickname = 'mate_user'), null, 'mate is not findable by nick');

-- Counter-request: mate asks stranger back, and they are friends at once.
select pg_temp.login('00000000-0000-0000-0000-0000000000a4');
select is(public.send_friend_request('00000000-0000-0000-0000-0000000000a3')->>'status', 'friends', 'counter-request makes a friendship');
reset role;
select is((select count(*)::int from public.friend_requests where '00000000-0000-0000-0000-0000000000a3' in (from_user, to_user)), 0, 'no request left hanging');
select ok(public.are_friends('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a3'), 'friends both ways');

-- Accept and decline.
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select public.send_friend_request('00000000-0000-0000-0000-0000000000a3');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select public.respond_friend_request((public.my_inbox()->'friend_requests'->0->>'id')::bigint, false);
select is(json_array_length(public.my_inbox()->'friend_requests'), 0, 'declined request is gone');
select pg_temp.login('00000000-0000-0000-0000-0000000000a5');
select public.send_friend_request('00000000-0000-0000-0000-0000000000a3');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$select public.respond_friend_request((select id from public.friend_requests limit 1), true)$$, 'answering someone else''s request does nothing');
select pg_temp.login('00000000-0000-0000-0000-0000000000a3');
select public.respond_friend_request((public.my_inbox()->'friend_requests'->0->>'id')::bigint, true);
select results_eq($$select name from public.my_friends()$$, $$values ('Другой'::text), ('Сосед'::text)$$, 'accepted friend is on the list, sorted by name');

-- Search: prefix from 2 characters, @ ignored, no email, flags.
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.search_users('f')), 0, 'one character finds nothing');
select results_eq($$select name, nickname, is_friend from public.search_users('@FRI')$$, $$values ('Друг'::text, 'friend_user'::text, true)$$, 'prefix search, case and @ ignored');
select is((select name from public.search_users('str')), 'stranger', 'nameless person shows the nickname');
select public.send_friend_request('00000000-0000-0000-0000-0000000000a3');
select is((select requested from public.search_users('str')), true, 'sent request is marked');
select is((select count(*)::int from information_schema.routines r
           join information_schema.parameters p on p.specific_name = r.specific_name
           where r.routine_name = 'search_users' and p.parameter_name = 'email'), 0, 'search returns no email');

select public.remove_friend('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.my_friends()), 1, 'removed friend is gone');
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.my_friends() where nickname = 'me_user'), 0, 'for both sides');
select * from finish();
rollback;
