// Spec 7: the first load's JavaScript must stay within 250 KB gzip (the
// redesign spec: «Бюджет первой загрузки»). Run after a production build;
// fails CI when the chunks index.html loads (its scripts and modulepreloads)
// grow past the budget. Chunks loaded later (the background refresh) are
// reported apart.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_KB = 250;
const dir = new URL('../dist/assets/', import.meta.url).pathname;
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const first = new Set([...html.matchAll(/(?:src|href)="[^"]*assets\/([^"/]+\.js)"/g)].map((m) => m[1]));
const all = readdirSync(dir).filter((f) => f.endsWith('.js'));
const files = all.filter((f) => first.has(f));
const size = (list) => list.reduce((sum, f) => sum + gzipSync(readFileSync(join(dir, f)), { level: 9 }).length, 0) / 1024;
const kb = size(files);
console.log(`JS gzip, first load: ${kb.toFixed(1)} KB of ${BUDGET_KB} KB (${files.length} file${files.length === 1 ? '' : 's'}); loaded later: ${size(all.filter((f) => !first.has(f))).toFixed(1)} KB`);
if (kb > BUDGET_KB) {
  console.error(`Over budget by ${(kb - BUDGET_KB).toFixed(1)} KB`);
  process.exit(1);
}
