import { describe, expect, it } from 'vitest';
import { checkOtherDraft, linkDomain, matchCategory, normalizeLink, otherCategories, visibleOther, type OtherItem } from '../../src/lib/other';

const item = (p: Partial<OtherItem>): OtherItem => ({ id: 'x', category: 'Книги', title: 'Дюна', description: '', links: [], status: 'want', rating: null, created_at: '2026-10-20T10:00:00Z', mine: true, ...p });
const draft = { title: 'Дюна', category: 'Книги', description: '', links: [] as string[], status: 'want' as const, rating: null };

describe('«Другое»', () => {
  it('categories ignore case, keep the first spelling and put the most used first', () => {
    const items = [
      item({ id: '1', category: 'книги', created_at: '2026-10-21T00:00:00Z' }),
      item({ id: '2', category: 'Книги', created_at: '2026-10-19T00:00:00Z' }),
      item({ id: '3', category: 'Театр' })
    ];
    expect(otherCategories(items)).toEqual([{ name: 'Книги', count: 2 }, { name: 'Театр', count: 1 }]);
    expect(matchCategory(' КНИГИ ', items)).toBe('Книги');
    expect(matchCategory('Рестораны', items)).toBe('Рестораны');
  });

  it('links: https:// is added, only http(s) passes, shown by domain', () => {
    expect(normalizeLink(' livelib.ru/book/1 ')).toBe('https://livelib.ru/book/1');
    expect(normalizeLink('http://a.ru')).toBe('http://a.ru');
    expect(normalizeLink('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(checkOtherDraft({ ...draft, links: ['javascript:alert(1)'] }).links).toBeTruthy();
    expect(checkOtherDraft({ ...draft, links: ['https://localhost'] }).links).toBeTruthy();
    expect(checkOtherDraft({ ...draft, links: ['https://a.ru', 'https://b.ru', 'https://c.ru', 'https://d.ru'] }).links).toBeTruthy();
    expect(checkOtherDraft({ ...draft, links: ['https://www.livelib.ru/x'] })).toEqual({});
    expect(linkDomain('https://www.livelib.ru/book/1')).toBe('livelib.ru');
  });

  it('title and category are required and limited', () => {
    expect(checkOtherDraft({ ...draft, title: '  ', category: '' })).toEqual({ title: 'Напиши название', category: 'Выбери или напиши категорию' });
    expect(checkOtherDraft({ ...draft, title: 'a'.repeat(201) }).title).toBeTruthy();
    expect(checkOtherDraft({ ...draft, category: 'a'.repeat(41) }).category).toBeTruthy();
    expect(checkOtherDraft({ ...draft, description: 'a'.repeat(2001) }).description).toBeTruthy();
  });

  it('filters by category, status and search; «Хочу» first, newest first', () => {
    const items = [
      item({ id: 'a', title: 'Старая', created_at: '2026-10-01T00:00:00Z' }),
      item({ id: 'b', title: 'Новая', created_at: '2026-10-05T00:00:00Z' }),
      item({ id: 'c', title: 'Прочитана', status: 'done', created_at: '2026-10-10T00:00:00Z' }),
      item({ id: 'd', title: 'Пушкин', category: 'Рестораны', description: 'на Тверском' })
    ];
    expect(visibleOther(items, { category: null, status: null, search: '' }).map((i) => i.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(visibleOther(items, { category: 'книги', status: null, search: '' }).map((i) => i.id)).toEqual(['b', 'a', 'c']);
    expect(visibleOther(items, { category: null, status: 'done', search: '' }).map((i) => i.id)).toEqual(['c']);
    expect(visibleOther(items, { category: null, status: null, search: 'тверск' }).map((i) => i.id)).toEqual(['d']);
  });
});
