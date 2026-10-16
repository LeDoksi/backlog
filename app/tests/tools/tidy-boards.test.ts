// The one-time tidy of every board (BL-113) on the live answers recorded 2026-10-14.
import { describe, expect, it } from 'vitest';
import { tidyBoard, tidySql } from '../../tools/tidy-boards';
import type { TitleRow } from '../../src/lib/titleRow';
import { liveFetch } from '../fixtures/liveFetch';

const env = { fetchFn: liveFetch, now: new Date('2026-10-14T12:00:00Z'), tmdbKey: 'KEY', rawgKey: '', proxy: null, loadImage: async () => false, pause: async () => {} };
const row = (id: string, extra: Partial<TitleRow>): TitleRow =>
  ({ workspace_id: 'b1', id, title: id, category: 'anime', status: 'queue', checked_parts: {}, parts: null, created_at: '2026-01-01T00:00:00Z', ...extra });

describe('tidyBoard', () => {
  it('an old-site list with progress is built again, ticks by count, and stops being manual', async () => {
    const legacy = [{ name: 'Сезон 1', released: true }, { name: 'Сезон 2', released: false }];
    const r = await tidyBoard('b1', [row('frieren', { title: 'Фрирен', status: 'in_progress', source: 'shikimori', source_id: '52991', parts: legacy, parts_manual: true, checked_parts: { '0': '2026-01-01' } })], env);
    const sent = r.calls.flatMap((c) => c.updates).filter((u) => u.id === 'frieren' && u.parts);
    // The daily refresh may touch the list first; the rebuild is the last word.
    const last = sent[sent.length - 1]!;
    expect((last.parts as { ref?: string }[]).every((p) => p.ref)).toBe(true);
    expect(Object.values(last.checked_parts as object)).toEqual(['2026-01-01']);
    expect(r.direct).toEqual([expect.objectContaining({ id: 'frieren', set: { parts_manual: false } })]);
    expect(r.review.join('\n')).toMatch(/Фрирен.*список пересобран/);
  });

  it('a game gets one spelling of its platforms and genres', async () => {
    const r = await tidyBoard('b1', [row('g', { category: 'game', platforms: ['PC', 'PlayStation 5', 'PS5'], genres: ['Action'] })], env);
    expect(r.direct).toEqual([{ board: 'b1', id: 'g', set: { platforms: ['PC', 'PS5'], genres: ['Экшены'] }, where: { platforms: ['PC', 'PlayStation 5', 'PS5'], genres: ['Action'] } }]);
  });
});

describe('tidySql', () => {
  it('runs each title on its own, as a member, quietly, in one transaction', () => {
    const sql = tidySql([{
      calls: [{ board: 'b1', updates: [{ id: 'a', title: "It's" }, { id: 'b' }], deletes: [] }, { board: 'b1', updates: [{ id: 'c' }], deletes: [{ id: 'd' }] }],
      direct: [{ board: 'b1', id: 'g', set: { platforms: ['PS5'] }, where: { platforms: ['PlayStation 5'], genres: null } }],
      review: []
    }]);
    expect(sql).toMatch(/^begin;$/m);
    expect(sql).toMatch(/^commit;$/m);
    expect(sql.match(/apply_title_refresh\(/g)).toHaveLength(3);
    expect(sql).toContain(`'c,d'`);
    expect(sql).toContain(`"title":"It's"`);
    expect(sql).toContain(`request.jwt.claims`);
    expect(sql).toMatch(/set_config\('bl\.quiet', '1', true\);\nupdate public\.titles set platforms = \$tidy\$\["PS5"\]\$tidy\$::jsonb where workspace_id = 'b1' and id = 'g' and platforms is not distinct from \$tidy\$\["PlayStation 5"\]\$tidy\$::jsonb and genres is not distinct from null;/);
  });
});
