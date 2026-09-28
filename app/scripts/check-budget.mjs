// Spec 7: the app's JavaScript must stay within 250 KB gzip. Run after a
// production build; fails CI when the entry chunks grow past the budget.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 250;
const dir = new URL('../dist/assets/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
const total = files.reduce((sum, f) => sum + gzipSync(readFileSync(join(dir, f)), { level: 9 }).length, 0);
const kb = total / 1024;
console.log(`JS gzip: ${kb.toFixed(1)} KB of ${BUDGET_KB} KB (${files.length} file${files.length === 1 ? '' : 's'})`);
if (kb > BUDGET_KB) {
  console.error(`Over budget by ${(kb - BUDGET_KB).toFixed(1)} KB`);
  process.exit(1);
}
