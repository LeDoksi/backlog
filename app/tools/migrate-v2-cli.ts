// Entry point for `npx vite-node tools/migrate-v2-cli.ts …` (vite-node drops
// the script path from argv, so the module itself cannot tell it was run).
import { main } from './migrate-v2';

main(process.argv.slice(2)).then((code) => process.exit(code));
