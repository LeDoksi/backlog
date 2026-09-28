import type { Category, Status, Title } from '../lib/types';
import { partsProgress, hasPartsChecklist } from '../lib/storage';

export const CATEGORY_LABEL: Record<Category, string> = { anime: 'Аниме', movie: 'Кино', series: 'Сериал', game: 'Игра' };
/** Category choices in the order forms offer them. */
export const CATEGORY_OPTIONS: { value: Category; label: string }[] = (['movie', 'series', 'anime', 'game'] as const).map((value) => ({ value, label: CATEGORY_LABEL[value] }));
export const CATEGORY_TAB: Record<'all' | Category, string> = { all: 'Всё', anime: 'Аниме', movie: 'Кино', series: 'Сериалы', game: 'Игры' };
export const STATUS_CARD: Record<Status, string> = { queue: 'В бэклоге', in_progress: 'Смотрю', done: 'Завершено', unreleased: 'Ещё не вышло' };
export const STATUS_FILTER: Record<Status, string> = { queue: 'В бэклоге', in_progress: 'В процессе', done: 'Завершено', unreleased: 'Ещё не вышло' };

export function metaLine(t: Title): string {
  return [CATEGORY_LABEL[t.category], t.year].filter(Boolean).join(', ');
}

/** The poster strip for a title with parts: "2 из 3" and what is still coming. */
export function cardProgress(t: Title, checked: number[] | undefined): { left: string; right: string; pct: number } | null {
  if (!hasPartsChecklist(t)) return null;
  const p = partsProgress(t.parts, checked ?? []);
  const total = t.parts.length;
  return {
    left: `${p.watched} из ${total}`,
    right: p.pending > 0 ? `ждём ${p.released + 1}-й` : '',
    pct: total ? p.watched / total : 0
  };
}

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
