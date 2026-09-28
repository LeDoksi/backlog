#!/usr/bin/env bash
# Two connections add the same person to two different shared boards at the
# same time. The limit trigger has to serialize them: exactly one may win.
# Run by run-local.sh against its throwaway database (PG* env already set).
set -uo pipefail
psql -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'race@test') on conflict do nothing;
insert into public.workspaces (id, kind) values
  ('f0000000-0000-0000-0000-000000000001', 'shared'), ('f0000000-0000-0000-0000-000000000002', 'shared') on conflict do nothing;
SQL
join() { psql -q -v ON_ERROR_STOP=1 -c "begin; insert into public.workspace_members (workspace_id, user_id) values ('$1', '00000000-0000-0000-0000-0000000000f1'); select pg_sleep(1); commit;" >/dev/null 2>&1; }
join f0000000-0000-0000-0000-000000000001 & a=$!
sleep 0.3
join f0000000-0000-0000-0000-000000000002 & b=$!
wait $a; wait $b
n=$(psql -tA -c "select count(*) from public.workspace_members where user_id = '00000000-0000-0000-0000-0000000000f1'")
psql -q -c "delete from public.workspace_members where user_id = '00000000-0000-0000-0000-0000000000f1'; delete from public.workspaces where id::text like 'f0000000%'; delete from auth.users where id = '00000000-0000-0000-0000-0000000000f1';" >/dev/null
if [ "$n" = 1 ]; then echo "ok - racing joins to two shared boards: one wins"; else echo "not ok - racing joins left $n shared memberships"; exit 1; fi
