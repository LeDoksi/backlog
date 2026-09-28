// Entry point for `npx vite-node tools/backfill-sources-cli.ts …` (vite-node
// drops the script path from argv, so the module cannot tell it was run).
import { main } from './backfill-sources';

main(process.argv.slice(2)).then((code) => process.exit(code));
