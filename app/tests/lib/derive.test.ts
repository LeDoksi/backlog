import { describe, expect, it } from 'vitest';
import { materialize } from '../../src/lib/derive';
import type { Part } from '../../src/lib/types';

const out = (name: string, released = true): Part => ({ name, released });
const show = (parts: Part[] | null, status: 'queue' | 'in_progress' | 'done' | 'unreleased' = 'queue', manualStatus: 'done' | null = null) =>
  ({ category: 'series' as const, parts, status, manualStatus });

describe('materialize', () => {
  it('no parts: the status stays as set', () => {
    expect(materialize({ category: 'movie', parts: null, status: 'done' }, [])).toEqual({ status: 'done', manualStatus: null, airingStatus: null });
  });

  it('nothing released yet: unreleased, never "still airing"', () => {
    expect(materialize(show([out('S1', false)]), [])).toEqual({ status: 'unreleased', manualStatus: 'queue', airingStatus: 'completed' });
  });

  it('nothing checked: queue', () => {
    expect(materialize(show([out('S1'), out('S2')]), [])).toMatchObject({ status: 'queue', airingStatus: 'completed' });
  });

  it('partly checked: in progress', () => {
    expect(materialize(show([out('S1'), out('S2')]), [0])).toMatchObject({ status: 'in_progress' });
  });

  it('all released checked but more announced: in progress and still airing', () => {
    expect(materialize(show([out('S1'), out('S2', false)]), [0])).toMatchObject({ status: 'in_progress', airingStatus: 'ongoing' });
  });

  it('everything out and checked: done', () => {
    expect(materialize(show([out('S1'), out('S2')]), [0, 1])).toMatchObject({ status: 'done', airingStatus: 'completed' });
  });

  it('keeps the hand-set status under the derived one', () => {
    expect(materialize(show([out('S1')], 'done'), []).manualStatus).toBe('done');
    // A second recompute must not overwrite it with the derived value.
    expect(materialize(show([out('S1')], 'queue', 'done'), [0]).manualStatus).toBe('done');
  });

  it('parts removed: the hand-set status comes back', () => {
    expect(materialize(show([], 'queue', 'done'), [])).toEqual({ status: 'done', manualStatus: null, airingStatus: null });
  });

  it('anime counts, games and movies never derive', () => {
    expect(materialize({ category: 'anime', parts: [out('S1')], status: 'queue' }, [0]).status).toBe('done');
    expect(materialize({ category: 'game', parts: [out('S1')], status: 'queue' }, [0]).status).toBe('queue');
  });
});
