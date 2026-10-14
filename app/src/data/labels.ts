import type { Category, Status, Title } from '../lib/types';
import { partsProgress, hasPartsChecklist } from '../lib/storage';

export const CATEGORY_LABEL: Record<Category, string> = { anime: 'Аниме', movie: 'Кино', series: 'Сериал', game: 'Игра' };
/** Category choices in the order forms offer them. */
export const CATEGORY_OPTIONS: { value: Category; label: string }[] = (['movie', 'series', 'anime', 'game'] as const).map((value) => ({ value, label: CATEGORY_LABEL[value] }));
export const CATEGORY_TAB: Record<'all' | Category, string> = { all: 'Всё', anime: 'Аниме', movie: 'Кино', series: 'Сериалы', game: 'Игры' };
export const STATUS_CARD: Record<Status, string> = { queue: 'В бэклоге', in_progress: 'Смотрю', done: 'Завершено', unreleased: 'Ещё не вышло' };
/** The card's status word; a game in progress is «Играю». */
export function statusLabel(status: Status, category: Category): string {
  return status === 'in_progress' && category === 'game' ? 'Играю' : STATUS_CARD[status];
}
export const STATUS_FILTER: Record<Status | 'waiting', string> = { queue: 'В бэклоге', in_progress: 'В процессе', waiting: 'Ждёт продолжения', done: 'Завершено', unreleased: 'Ещё не вышло' };
/** On the card instead of «Смотрю» when everything out is watched and more is coming (spec 2.4). */
export const STATUS_CARD_WAITING = 'Ждёт продолжения';

export function metaLine(t: Title): string {
  return [CATEGORY_LABEL[t.category], t.year].filter(Boolean).join(', ');
}

/** The poster strip for a title with parts: "2 из 3" and what is still coming. */
export function cardProgress(t: Title, checked: number[] | undefined): { left: string; right: string; pct: number } | null {
  if (!hasPartsChecklist(t)) return null;
  const p = partsProgress(t.parts, checked ?? []);
  // Extras (OVA, specials) are not counted: «X из Y» is main parts only.
  const total = p.released + p.pending;
  return {
    left: `${p.watched} из ${total}`,
    right: p.pending > 0 ? `ждём ${p.released + 1}-й` : '',
    pct: total ? p.watched / total : 0
  };
}

export { plural } from '../lib/plural';
