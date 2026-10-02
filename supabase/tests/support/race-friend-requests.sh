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
psql -q -c "delete from public.friendships where user_a = '$a'; delete from public.friend_requests where from_user in ('$a', '$b'); delete from auth.users where id in ('$a', '$b');" >/dev/null
if [ "$res" = 1/0 ]; then echo "ok - crossing friend requests: one friendship"; else echo "not ok - crossing friend requests left friendships/requests = $res"; exit 1; fi
