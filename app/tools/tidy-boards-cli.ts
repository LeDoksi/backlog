// Entry point for `npx vite-node tools/tidy-boards-cli.ts …` (vite-node
// drops the script path from argv, so the module cannot tell it was run).
import { main } from './tidy-boards';

main(process.argv.slice(2)).then((code) => process.exit(code));
