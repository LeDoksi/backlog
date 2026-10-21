// «Другое» (BL-119): the form's checks, categories and filters. Loaded
// with the tab; the server calls and types are in lib/otherApi.ts.
import type { OtherDraft, OtherItem, OtherStatus } from './otherApi';

export type { OtherDraft, OtherItem, OtherStatus } from './otherApi';

export const OTHER_LIMITS = { title: 200, category: 40, description: 2000, links: 3, link: 500 };
export const OTHER_STATUS_LABEL: Record<OtherStatus, string> = { want: 'Хочу', done: 'Готово' };

const LINK = /^https?:\/\/[^\s/]+\.[^\s]*$/i;

/** A link as typed: «example.com/x» gets https:// in front; anything else is left for the check to refuse. */
export function normalizeLink(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
}

export function linkOk(link: string): boolean {
  return link.length <= OTHER_LIMITS.link && LINK.test(link);
}

/** «www.livelib.ru/book/1» → «livelib.ru». */
export function linkDomain(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return link;
  }
}

export type OtherField = 'title' | 'category' | 'description' | 'links';

/** What is wrong with the form, field by field; empty when it can be saved. */
export function checkOtherDraft(d: OtherDraft): Partial<Record<OtherField, string>> {
  const out: Partial<Record<OtherField, string>> = {};
  const title = d.title.trim();
  const category = d.category.trim();
  if (!title) out.title = 'Напиши название';
  else if (title.length > OTHER_LIMITS.title) out.title = `Не длиннее ${OTHER_LIMITS.title} знаков`;
  if (!category) out.category = 'Выбери или напиши категорию';
  else if (category.length > OTHER_LIMITS.category) out.category = `Не длиннее ${OTHER_LIMITS.category} знаков`;
  if (d.description.trim().length > OTHER_LIMITS.description) out.description = `Не длиннее ${OTHER_LIMITS.description} знаков`;
  if (d.links.length > OTHER_LIMITS.links) out.links = `Не больше ${OTHER_LIMITS.links} ссылок`;
  else if (d.links.some((l) => !linkOk(l))) out.links = 'Ссылка должна выглядеть как https://сайт.ru/…';
  return out;
}

/**
 * Categories on the board, most used first. «книги» and «Книги» are one,
 * shown as written first (the server keeps that spelling too).
 */
export function otherCategories(items: OtherItem[]): { name: string; count: number }[] {
  const byKey = new Map<string, { name: string; count: number; first: string }>();
  items.forEach((i) => {
    const key = i.category.toLowerCase();
    const cur = byKey.get(key);
    if (!cur) byKey.set(key, { name: i.category, count: 1, first: i.created_at });
    else {
      cur.count += 1;
      if (i.created_at < cur.first) { cur.first = i.created_at; cur.name = i.category; }
    }
  });
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))
    .map(({ name, count }) => ({ name, count }));
}

/** The spelling a typed category will get: an existing one when only the case differs. */
export function matchCategory(typed: string, items: OtherItem[]): string {
  const t = typed.trim();
  return otherCategories(items).find((c) => c.name.toLowerCase() === t.toLowerCase())?.name ?? t;
}

export interface OtherFilter { category: string | null; status: OtherStatus | null; search: string }

/** «Хочу» first, then newest first, as the board's other tabs put the queue on top. */
export function visibleOther(items: OtherItem[], f: OtherFilter): OtherItem[] {
  const q = f.search.trim().toLowerCase();
  return items
    .filter((i) => (!f.category || i.category.toLowerCase() === f.category.toLowerCase())
      && (!f.status || i.status === f.status)
      && (!q || i.title.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'want' ? -1 : 1) || b.created_at.localeCompare(a.created_at));
}

/** A server error as a sentence for the form. */
export function otherErrorText(error: string | undefined): string {
  if (error === 'not_author') return 'Менять текст может только тот, кто добавил запись.';
  if (error && /bad_/.test(error)) return 'Проверь поля: что-то не подходит.';
  return 'Не получилось сохранить. Проверь сеть и попробуй ещё раз.';
}
