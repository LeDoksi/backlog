import { describe, expect, it } from 'vitest';
import { formFromTitle, newPart, patchFromForm, remapChecked, validateForm } from '../../src/screens/EditTitle/editForm';
import type { Title } from '../../src/lib/types';

const t: Title = { id: 'x', title: 'Драйв', category: 'movie', status: 'queue', genres: ['драма'], year: 2011, cover: 'c.jpg', synopsis: '' };

describe('edit form', () => {
  it('an untouched form produces no patch', () => {
    const f = formFromTitle(t);
    expect(patchFromForm(f, formFromTitle(t))).toEqual({});
  });
  it('one changed field gives a one-field patch', () => {
    const init = formFromTitle(t);
    expect(patchFromForm({ ...init, title: 'Драйв 2' }, init)).toEqual({ title: 'Драйв 2' });
  });
  it('«Ещё не вышло» turns into a status write', () => {
    const init = formFromTitle(t);
    expect(patchFromForm({ ...init, unreleased: true }, init)).toEqual({ status: 'unreleased' });
  });
  it('empty part rows are dropped', () => {
    const s: Title = { ...t, category: 'series', parts: [{ name: 'S1', year: 2020, released: true }] };
    const init = formFromTitle(s);
    const f = { ...init, parts: [...init.parts, { key: 999, name: '', year: '', released: true }] };
    expect(patchFromForm(f, init)).toEqual({});
  });
  it('validates the title and year', () => {
    expect(validateForm({ ...formFromTitle(t), title: ' ', year: '20' })).toEqual({ title: 'Нужно название', year: 'Год из четырёх цифр' });
  });
});

describe('remapChecked', () => {
  const t = { id: 's', title: 'S', category: 'series', status: 'in_progress', genres: [], parts: [{ name: 'S1' }, { name: 'S2' }, { name: 'S3' }] } as unknown as Title;

  it('follows watched parts through a reorder', () => {
    const f = formFromTitle(t);
    const moved = { ...f, parts: [f.parts[2]!, f.parts[0]!, f.parts[1]!] };
    expect(remapChecked(moved, [0, 1])).toEqual([1, 2]);
  });
  it('drops a removed part and shifts the rest', () => {
    const f = formFromTitle(t);
    expect(remapChecked({ ...f, parts: [f.parts[1]!, f.parts[2]!] }, [0, 1])).toEqual([0]);
  });
  it('is null when nothing moved', () => {
    const f = formFromTitle(t);
    expect(remapChecked({ ...f, parts: [...f.parts, newPart({ name: 'S4' })] }, [1, 0])).toBeNull();
  });
});
