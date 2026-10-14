// A fetch that answers from the live responses recorded 2026-10-14
// (tests/fixtures/live). Unknown URLs answer 404.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FetchLike } from '../../src/lib/types';

const dir = join(__dirname, 'live');

const SEARCHES: Record<string, string> = {
  'атака титанов': 'attack-on-titan', 'адский рай': 'hells-paradise', 'синяя тюрьма': 'blue-lock',
  'этот замечательный мир': 'konosuba', 'гинтама': 'gintama'
};

// Shikimori answers the same graph for any entry of a franchise, so an entry
// without its own recording answers from the recording that holds it.
function franchiseFile(id: number): string | null {
  if (existsSync(join(dir, `shiki-franchise-${id}.json`))) return `shiki-franchise-${id}.json`;
  return readdirSync(dir).filter((f) => f.startsWith('shiki-franchise-'))
    .find((f) => (JSON.parse(readFileSync(join(dir, f), 'utf8')).nodes as { id: number }[]).some((n) => n.id === id)) ?? null;
}

export function liveFile(url: string): string | null {
  const u = new URL(url.replace(/^https:\/\/[^/]+\/(https:)/, '$1'));
  let m;
  if ((m = /^\/3\/tv\/(\d+)$/.exec(u.pathname))) return `tmdb-tv-${m[1]}.json`;
  if ((m = /^\/api\/animes\/(\d+)\/franchise$/.exec(u.pathname))) return franchiseFile(Number(m[1]));
  if ((m = /^\/api\/animes\/(\d+)\/related$/.exec(u.pathname))) return `shiki-related-${m[1]}.json`;
  if ((m = /^\/api\/animes\/(\d+)$/.exec(u.pathname))) return `shiki-anime-${m[1]}.json`;
  if (u.pathname === '/api/animes') { const s = SEARCHES[(u.searchParams.get('search') ?? '').toLowerCase()]; return s ? `shiki-search-${s}.json` : null; }
  return null;
}

export function liveBody(url: string): unknown | null {
  const f = liveFile(url);
  if (!f || !existsSync(join(dir, f))) return null;
  return JSON.parse(readFileSync(join(dir, f), 'utf8'));
}

export const liveFetch: FetchLike = (url) => {
  const body = liveBody(url);
  return Promise.resolve(body == null
    ? { ok: false, status: 404, json: () => Promise.resolve({}) }
    : { ok: true, status: 200, json: () => Promise.resolve(body) });
};
