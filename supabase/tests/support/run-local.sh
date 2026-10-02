#!/usr/bin/env bash
# Runs the pgTAP tests against a throwaway local Postgres: shim.sql (the bits
# of Supabase the schema needs), then every migration in order, then
# pg_prove over supabase/tests/*.sql. Needs postgres + pgtap installed
# (apt: postgresql-16 postgresql-16-pgtap). Usage: supabase/tests/support/run-local.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
tests="$root/supabase/tests"
bin="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
dir="$(mktemp -d)"
port="${PGTEST_PORT:-54329}"
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
chmod 777 "$dir"
as_pg "$bin/initdb -D $dir/data -U postgres -A trust >/dev/null"
as_pg "$bin/pg_ctl -D $dir/data -o '-p $port -k $dir -c wal_level=logical' -l $dir/log start >/dev/null"
trap 'as_pg "$bin/pg_ctl -D $dir/data stop -m fast >/dev/null"; rm -rf "$dir"' EXIT
export PGHOST="$dir" PGPORT="$port" PGUSER=postgres PGDATABASE=postgres
psql -q -v ON_ERROR_STOP=1 -f "$here/shim.sql" >/dev/null
rollbacks="$root/supabase/rollbacks"
apply() { psql -q -v ON_ERROR_STOP=1 -f "$1" >/dev/null || { echo "failed: $1"; exit 1; }; }
schema() { pg_dump --schema-only --no-owner --exclude-schema=pgtap "$@" | grep -v -E '^--|^$|^SET |^SELECT pg_catalog|^.(un)?restrict '; }
# Migrations that ship a rollback (supabase/rollbacks/<same name>) are the
# reversible ones; everything before them is history.
reversible=()
# A migration without a rollback after reversible ones (drop_legacy) cannot
# be stepped back over, so everything before it becomes history too.
for f in "$root"/supabase/migrations/*.sql; do
  if [ -f "$rollbacks/$(basename "$f")" ]; then
    [ ${#reversible[@]} -eq 0 ] && schema > "$dir/before.sql"
    reversible+=("$f")
  else
    reversible=()
  fi
  apply "$f"
done
pg_prove --ext .sql "$tests"/*.sql
"$here/race-board-limit.sh"
"$here/race-friend-requests.sh"
[ ${#reversible[@]} -eq 0 ] && exit 0
echo "rollback check: down ${#reversible[@]} migrations, compare schema, up again"
for (( i=${#reversible[@]}-1; i>=0; i-- )); do apply "$rollbacks/$(basename "${reversible[$i]}")"; done
schema > "$dir/after.sql"
diff -u "$dir/before.sql" "$dir/after.sql" || { echo "rollbacks do not restore the schema"; exit 1; }
for f in "${reversible[@]}"; do apply "$f"; done
pg_prove --ext .sql "$tests"/*.sql
"$here/race-board-limit.sh"
"$here/race-friend-requests.sh"
