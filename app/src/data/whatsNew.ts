// «Что нового» in the profile (BL-116): notable updates, newest first.
//
// To add an entry, put it at the top of WHATS_NEW with today's date. That is
// all: everyone whose read mark is older sees the dot on «Профиль» until they
// open the list. Only notable things go here, about once a week or two, in
// plain words. One entry per day: two with the same date count as one for
// the dot. Georgy approves the wording in the thread before it ships.
export interface WhatsNewEntry { date: string; title: string; points: string[] }

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    date: '2026-10-21',
    title: 'Что изменилось с середины октября',
    points: [
      'Сезоны и части франшиз теперь появляются и обновляются сами: вышел новый сезон, карточка об этом знает.',
      'Фильмы-продолжения встают в общий список частей, а OVA и спешлы лежат отдельным блоком.',
      'Если одна франшиза попала на доску несколько раз, карточки сами склеились в одну.',
      'У игр вертикальные обложки и описание на русском.',
      'Старые карточки приведены к тому же виду, что и карточки из поиска.',
      'Своя оценка от 1 до 10, у игр есть статус «Играю» и кнопка «Во что поиграть?».',
      'В ленте друзей всё, что друг сделал за день, собрано в одну строку. Нажми, и увидишь подробности или карточку тайтла друга.',
      'Удалил карточку по ошибке? В меню «…» есть отмена.',
      'Бэклог стал закрытым клубом: новых людей приглашаю только я, ссылки одноразовые, друзей ищем по нику.',
      'В профиле появились «Как мы используем данные» и «Удалить аккаунт».',
      'Вкладка «Другое» для всего, чего нет в поиске: книги, комиксы, рестораны, спектакли. Включается в «Профиль → Оформление», по умолчанию выключена. Записи создаёшь сам (название, категория, описание, до трёх ссылок), свои категории становятся фильтрами, статусы «Хочу» и «Готово», есть оценка. Это только для тебя: в ленту, статистику, лидерборд и друзьям не попадает.',
      'И сам раздел «Что нового»: здесь буду рассказывать о заметных обновлениях. Когда появится новое, на «Профиле» загорится точка, и погаснет, как только прочитаешь.'
    ]
  }
];

/**
 * Entries whose day has come (UTC). An entry may be dated the day after the
 * code ships: it then shows up on its own at midnight, instead of lighting a
 * dot that opening the list cannot clear (the server keeps the mark ≤ now).
 */
export function currentWhatsNew(now: Date = new Date(), entries: WhatsNewEntry[] = WHATS_NEW): WhatsNewEntry[] {
  const today = now.toISOString().slice(0, 10);
  return entries.filter((e) => e.date <= today);
}

/** The date the read mark moves to when the list is opened. */
export function latestWhatsNew(entries: WhatsNewEntry[] = currentWhatsNew()): string | null {
  return entries.length ? `${entries[0]!.date}T00:00:00Z` : null;
}

/**
 * Whether the dot is lit. `undefined` means the profile did not come from
 * the server (offline start): no dot rather than a false one. `null` is a
 * person who has never opened the list.
 */
export function hasUnreadWhatsNew(seenAt: string | null | undefined, entries: WhatsNewEntry[] = currentWhatsNew()): boolean {
  const latest = latestWhatsNew(entries);
  if (!latest || seenAt === undefined) return false;
  if (seenAt === null) return true;
  return Date.parse(latest) > Date.parse(seenAt);
}

const DAY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
export function whatsNewDate(date: string): string { return DAY.format(new Date(`${date}T00:00:00Z`)); }
