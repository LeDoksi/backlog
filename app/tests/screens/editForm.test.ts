import { describe, expect, it } from 'vitest';
import { formFromTitle, patchFromForm, validateForm } from '../../src/screens/EditTitle/editForm';
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
