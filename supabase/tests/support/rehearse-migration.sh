#!/usr/bin/env bash
# Dress rehearsal of the B data migration on a throwaway local Postgres:
# loads a JSON export of the old tables (same shape as the pre-B backup),
# applies every migration, runs the SQL that migrate-v2.ts generates, then
# verifies `titles` against the export and prints the boards.
# Usage: supabase/tests/support/rehearse-migration.sh <export.json>
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
export_json="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
bin="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
dir="$(mktemp -d)"
port="${PGTEST_PORT:-54330}"
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
chmod 777 "$dir"
as_pg "$bin/initdb -D $dir/data -U postgres -A trust >/dev/null"
as_pg "$bin/pg_ctl -D $dir/data -o '-p $port -k $dir -c wal_level=logical' -l $dir/log start >/dev/null"
trap 'as_pg "$bin/pg_ctl -D $dir/data stop -m fast >/dev/null"; rm -rf "$dir"' EXIT
export PGHOST="$dir" PGPORT="$port" PGUSER=postgres PGDATABASE=postgres
run() { psql -q -v ON_ERROR_STOP=1 "$@"; }
run -f "$here/shim.sql" >/dev/null
b_started=0
for f in "$root"/supabase/migrations/*.sql; do
  if [ $b_started = 0 ] && [ -f "$root/supabase/rollbacks/$(basename "$f")" ]; then
    b_started=1
    # The old data goes in right before the first B migration, as on the live project.
    cp "$export_json" "$dir/export.json"; chmod 644 "$dir/export.json"
    run >/dev/null <<SQL
create temp table dump as select pg_read_file('$dir/export.json')::jsonb as j;
alter table auth.users disable trigger user;
insert into auth.users (id, email) select (p->>'id')::uuid, p->>'email' from dump, jsonb_array_elements(j->'profiles') p;
insert into public.workspaces select * from jsonb_populate_recordset(null::public.workspaces, (select j->'workspaces' from dump));
insert into public.profiles select * from jsonb_populate_recordset(null::public.profiles, (select j->'profiles' from dump));
insert into public.allowed_emails select * from jsonb_populate_recordset(null::public.allowed_emails, (select j->'allowed_emails' from dump));
insert into public.drafts select * from jsonb_populate_recordset(null::public.drafts, (select j->'drafts' from dump));
insert into public.overrides select * from jsonb_populate_recordset(null::public.overrides, (select j->'overrides' from dump));
insert into public.parts select * from jsonb_populate_recordset(null::public.parts, (select j->'parts' from dump));
alter table auth.users enable trigger user;
SQL
  fi
  run -f "$f" >/dev/null
done
cd "$root/app"
npx vite-node tools/migrate-v2-cli.ts dry-run "$export_json"
npx vite-node tools/migrate-v2-cli.ts sql "$export_json" > "$dir/titles.sql"
run -f "$dir/titles.sql" >/dev/null
run -f "$dir/titles.sql" >/dev/null   # re-runnable
run -At -c "select coalesce(json_agg(t), '[]') from public.titles t" > "$dir/titles.json"
npx vite-node tools/migrate-v2-cli.ts verify "$export_json" "$dir/titles.json"
echo "boards:"
run -c "select w.kind, count(m.user_id) members, (select count(*) from public.titles t where t.workspace_id = w.id) titles
        from public.workspaces w left join public.workspace_members m on m.workspace_id = w.id group by w.id, w.kind order by 1, 3 desc"
run -c "select p.email, string_agg(w.kind, ', ' order by w.kind) from public.profiles p join public.workspace_members m on m.user_id = p.id join public.workspaces w on w.id = m.workspace_id group by p.email"
run -c "select count(*) filter (where completed_at is not null) as dated_done, count(*) filter (where started_at is not null) as dated_started from public.titles"
