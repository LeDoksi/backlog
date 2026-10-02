#!/usr/bin/env bash
# Two people send each other a friend request at the same moment. Each must
# see the other's request, so the pair ends up friends with no request left.
# Run by run-local.sh against its throwaway database (PG* env already set).
set -uo pipefail
a=00000000-0000-0000-0000-0000000000e1
b=00000000-0000-0000-0000-0000000000e2
psql -q -v ON_ERROR_STOP=1 -c "insert into auth.users (id, email) values ('$a', 'race-a@test'), ('$b', 'race-b@test') on conflict do nothing;" >/dev/null
ask() { psql -q -v ON_ERROR_STOP=1 -c "begin; select public.request_friendship('$1', '$2'); select pg_sleep(1); commit;" >/dev/null 2>&1; }
ask $a $b & p=$!
sleep 0.3
ask $b $a & q=$!
wait $p; wait $q
res=$(psql -tA -c "select (select count(*) from public.friendships where user_a = '$a' and user_b = '$b') || '/' || (select count(*) from public.friend_requests where from_user in ('$a', '$b'))")
psql -q -c "delete from public.friendships where user_a = '$a'; delete from public.friend_requests where from_user in ('$a', '$b');" >/dev/null
if [ "$res" = 1/0 ]; then echo "ok - crossing friend requests: one friendship"; else echo "not ok - crossing friend requests left friendships/requests = $res"; fail=1; fi

# B accepts A's request while A sends it again: friends, nothing left pending.
id=$(psql -qtA -c "insert into public.friend_requests (from_user, to_user) values ('$a', '$b') returning id")
psql -q -v ON_ERROR_STOP=1 -c "begin; set local request.jwt.claims = '{\"sub\":\"$b\"}'; select public.respond_friend_request($id, true); select pg_sleep(1); commit;" >/dev/null 2>&1 & p=$!
sleep 0.3
ask $a $b & q=$!
wait $p; wait $q
res=$(psql -tA -c "select (select count(*) from public.friendships where user_a = '$a' and user_b = '$b') || '/' || (select count(*) from public.friend_requests where from_user in ('$a', '$b'))")
psql -q -c "delete from public.friendships where user_a = '$a'; delete from public.friend_requests where from_user in ('$a', '$b'); delete from auth.users where id in ('$a', '$b');" >/dev/null
if [ "$res" = 1/0 ]; then echo "ok - accepting while the other asks again: one friendship"; else echo "not ok - accept vs ask left friendships/requests = $res"; fail=1; fi
exit ${fail:-0}
