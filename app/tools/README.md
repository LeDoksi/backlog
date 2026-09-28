# tools

Scripts run by hand with `npx vite-node`, never shipped in the app.

## migrate-v2 (phase B data migration)

Moves each board's titles from `drafts` + `overrides` + `parts` into `titles`
with the same code client C used to show them, and checks the result.

1. Export the old tables to JSON (`select json_build_object('drafts', …)`,
   same shape as the pre-B backup in the project files, `backups/`).
2. `npx vite-node tools/migrate-v2-cli.ts dry-run export.json` — per board:
   how many titles, how many with parts and with a hand-set status kept
   under the derived one.
3. `npx vite-node tools/migrate-v2-cli.ts sql export.json > titles.sql` and
   run `titles.sql` in the SQL editor (or Supabase MCP `execute_sql`). It
   upserts, so it can be re-run.
4. Export `titles` to JSON (`select json_agg(t) from titles t`) and run
   `npx vite-node tools/migrate-v2-cli.ts verify export.json titles.json`.
   Anything but `OK: 0 differences` means stop.

`supabase/tests/support/rehearse-migration.sh export.json` does all of it on
a throwaway local Postgres first.

## backfill-sources (phase B, external ids for old titles)

Fills `source` / `source_id` for titles added before C, so duplicate checks
and later matching between friends work for them.

1. Export `titles` to JSON (`select json_agg(t) from titles t`).
2. `npx vite-node tools/backfill-sources-cli.ts run titles.json out/` — asks
   the category's provider (3 requests a second at most) and writes
   `out/sources-auto.sql` (only unambiguous matches: same normalized name or
   original name, same year, one candidate) and `out/sources-review.md`.
3. Run `sources-auto.sql` in the SQL editor or MCP `execute_sql`; it only
   fills rows whose source is still empty.
4. The owner fills `выбор: провайдер:id` (or `выбор: нет`) in the review
   file; `npx vite-node tools/backfill-sources-cli.ts apply-review
   out/sources-review.md` prints the SQL for those choices.

Needs network access to TMDb, Shikimori, Steam/RAWG and the CORS proxy.
