# tools

Scripts run by hand with `npx vite-node`, never shipped in the app.

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

## tidy-boards (BL-113, every board brought to what the app makes of it)

Runs the one-time normalization, the daily refresh and a rebuild of every
season list made by hand on all boards at once, so nobody has to open
their board first, and gives game platforms and genres one spelling.

1. Export `titles` to JSON (`select json_agg(t) from titles t`).
2. `npx vite-node tools/tidy-boards-cli.ts run titles.json out/` writes
   `out/tidy.sql` and `out/tidy-review.md` (what changes, title by title).
3. Run `tidy.sql` in the SQL editor: one transaction, quiet (no feed),
   each call as a member of its board; a title edited since the export is
   skipped and counted in the last select.

Needs network access to TMDb, Shikimori, Steam/RAWG and the CORS proxy.
