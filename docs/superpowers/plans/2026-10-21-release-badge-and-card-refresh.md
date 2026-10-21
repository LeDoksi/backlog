# Выход фильмов и игр, обновление лица карточки (BL-117): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native: Georgy does not read code, Claude implements and reviews). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Фильмы и игры из поиска сами получают и снимают «Ещё не вышло»; у фильмов в карточке «Сейчас в кино» / «Вышло в цифре»; при выходе тост «Вышло: …»; раз в неделю лицо каждой карточки из поиска берётся из источника заново (постер, название, описание, жанры, год, платформы).

**Architecture:** Провайдеры (`lib/enrich`) отдают сырые даты, `lib/release.ts` без сети решает «вышло ли» и что показать. Карточка из `cardFor` несёт `release` (даты + вышло). Новая колонка `titles.release_date` (кинопремьера фильма / выход игры) и `titles.digital_date` (цифровой релиз фильма). Ежедневный проход (`refreshJob`) после сезонов запускает `faceJob`: сначала невышедшие и «в кино без цифры» (каждый день), потом все остальные карточки из поиска раз в 7 дней, по одной за раз, каждая своей тихой записью `apply_title_refresh` (устаревшая пропускается). После ежедневной части `dailyRefresh` показывает тост о вышедшем с прошлого визита (`lib/release.releaseEvents`, отметка в браузере). Старый ежедневный проход игр (`refreshGames`) поглощён `faceJob`.

**Tech Stack:** как раньше: React 19, Zustand, Vitest, Playwright, Supabase (pgTAP локально `supabase/tests/support/run-local.sh`).

**Spec:** `/mnt/project-files/review/2026-10-21-speka-chetyre-idei.md`, часть 2 (BL-117). Разбор: `/mnt/project-files/review/2026-10-21-chetyre-idei-prozharka.md`.

## Global Constraints

- Фильм вышел = прошла кинопремьера: самая ранняя дата типов 2 или 3 из TMDb `release_dates` среди всех стран; если таких нет, основная `release_date`. Цифра = самая ранняя дата типа 4.
- Игра Steam вышла = `release_date.coming_soon === false` и дата (если читается) не в будущем. Игра RAWG вышла = `tba !== true`, дата есть и не в будущем.
- Нет даты вовсе → «Ещё не вышло».
- Плашка ставится только на «В очереди», снимается только с «Ещё не вышло» (→ «В очереди»). «Смотрю»/«Завершено» не трогаются никогда.
- «Сейчас в кино»: премьера прошла и (цифра в будущем, или цифры нет и прошло меньше 90 дней). «Вышло в цифре»: 30 дней с цифрового релиза.
- Тексты: «Сейчас в кино», «Вышло в цифре», «Вышло: X», «Вышло: X и ещё N», «Вышло в кино: X», «Вышло в цифре: X»; для карточки из поиска «Ещё не вышло. Снимем отметку сами, когда выйдет.» (ручная карточка — как было).
- Защиты недельного обновления: русское название и описание не заменяются нерусскими; машинный перевод не заменяет живой русский текст; вертикальная обложка игры не заменяется широкой; «нет картинки» источника не обложка; ручные карточки не трогаются.
- Источник не ответил → ничего не меняем. Всё тихо (bl.quiet), без ленты.
- Продовый SQL запускает Георгий до выкладки (клиент пишет новые колонки при добавлении).

## Review Focus

1. Фильм «Смотрю» или «Завершено» с датой в будущем (смотрел на фестивале) не получает плашку — тест в задаче 2.
2. Перенос: вышедшая по старой дате игра снова `coming_soon` → плашка возвращается, но только у «В очереди» — тест в задаче 2.
3. Карточка добавлена уже после выхода — тоста нет; «Завершено» — тоста нет; первый визит без отметки — тоста нет (не засыпать старым) — тест в задаче 4.
4. «Локи» остаётся «Локи», русское описание не меняется на английское, вертикальная обложка игры не меняется на шапку Steam — тест в задаче 3.
5. Steam-дата по-русски («4 сен. 2025 г.», «Скоро выйдет», «1 кв. 2026 г.») разбирается без падений — тест в задаче 1 на живых фикстурах.

---

### Task 1: Даты выхода у провайдеров и правило «вышло» (`lib/release.ts`)

**Files:** Create `app/src/lib/release.ts`; Modify `app/src/lib/enrich.ts` (TMDb movie details с `append_to_response=release_dates`, Steam/RAWG отдают сырые даты), `app/src/data/cardSources.ts` (`Card.release`); Test `app/tests/lib/release.test.ts`, живые фикстуры `app/tests/fixtures/live/tmdb-movie-*.json`, `steam-app-*.json`, `rawg-game-*.json` (Remote Control).

**Interfaces (Produces):**
- `interface Release { date: string | null; digital: string | null; out: boolean }` (даты `YYYY-MM-DD`).
- `movieRelease(d: unknown, today: string): Release`, `steamRelease(d: unknown, today: string): Release`, `rawgRelease(d: unknown, today: string): Release`, `parseSteamDate(s: string): string | null`.
- `Details.release?: Release` у фильма и игры; `Card.release?: Release`.
- `releaseStatus(status: Status, out: boolean): Status` — правило плашки.
- `cinemaLabel(t: { category; releaseDate?; digitalDate? }, today: string): 'Сейчас в кино' | 'Вышло в цифре' | null`.
- `isSearchCard(t: { source?; sourceId? }): boolean` (для BL-118 тоже).

- [x] Тесты на фикстурах и правилах (Review Focus 1, 2, 5), реализация, `npx vitest run tests/lib/release.test.ts`, commit `feat: release dates from TMDb, Steam and RAWG (BL-117)`.

### Task 2: Колонки и тихая запись (SQL)

**Files:** Create `supabase/migrations/20261201000000_release_dates.sql`, `supabase/rollbacks/20261201000000_release_dates.sql`, `supabase/tests/release_dates.sql`; prod-скрипт `/mnt/project-files/sql/2026-10-21-release-dates.sql`.

- `titles.release_date date`, `titles.digital_date date`.
- `refresh_base_ok` знает `platforms`, `release_date`, `digital_date`; `apply_title_refresh` пишет их (ключ отсутствует → столбец как был).
- pgTAP: запись дат и платформ, отсутствие ключа ничего не трогает, база с другой датой → -1, ленты нет.
- Клиент: `Title.releaseDate`, `Title.digitalDate` ↔ колонки в `titleRow.ts` (WRITABLE).
- [x] `run-local.sh` зелёный, commit `feat(db): release dates on titles (BL-117)`.

### Task 3: Добавление из поиска и недельное лицо карточки

**Files:** Modify `app/src/data/newTitle.ts` (плашка и даты при добавлении), `app/src/data/enrichSearch.ts`, `app/src/lib/refresh.ts` (`cardFixes(row, card, 'weekly')`: правила недели + платформы + даты + статус), Create `app/src/data/faceJob.ts`; Modify `app/src/data/refreshJob.ts` (убрать `refreshGames`, вызвать `runFaceJob`); Test `app/tests/data/faceJob.test.ts`, `app/tests/lib/refresh.test.ts`, `app/tests/data/newTitle.test.ts`.

**Interfaces:** `runFaceJob(deps: RefreshDeps & { onChanges; onDailyDone? }): Promise<{ updated: number; changes }>`; хранение `face:<board>` = `{ id: last asked ms }`; ежедневные — невышедшие фильмы/игры и фильмы «в кино» без цифры (опрос не чаще раза в сутки); остальные — раз в 7 дней; при старте с пустой отметкой вся доска (как нормализация), по одной карточке, пауза 250 мс, ретрай Steam как `cardForRetry`.

- [x] Тесты: Review Focus 4; постер фильма сменился → новый; ожидаемый фильм при добавлении «Ещё не вышло»; вышедшая игра без даты получает `release_date` = сегодня; ручная карточка не опрашивается. Commit `feat: weekly card refresh and automatic release badge (BL-117)`.

### Task 4: Экран: строки кино, текст плашки, тост «Вышло»

**Files:** Modify `app/src/screens/TitleSheet/TitleSheet.tsx`, `app/src/data/dailyRefresh.ts`; Create в `lib/release.ts` `releaseEvents(titles, seenDay, today)` и `releaseToast(events)`; Test `app/tests/lib/release.test.ts`, e2e снимок карточки.

- Отметка `releases-seen:<board>` = день последнего показа; нет отметки → ставим сегодня без тоста.
- Событие: дата в (seenDay, today], карточка добавлена раньше даты, статус не «Завершено». Одно → кнопка «Открыть».
- [x] Тесты (Review Focus 3), проверка в браузере, commit `feat: in-cinema labels and «Вышло» toast (BL-117)`.

### Task 5: Выкладка

- [ ] Самопроверка ветки, CI зелёный, Георгий запускает prod SQL, мерж, деплой, канбан BL-117, запись в «Что нового» (когда BL-116 слит).

## Что показали живые ответы (Remote Control, 21.10.2026)

21 фильм и 15 игр записаны в `app/tests/fixtures/live/` (tmdb-movie-*, steam-app-*, rawg-game-*).
- Поле `status` у TMDb ненадёжно: «Released» у фильмов, которые вышли только в одной стране или нигде ещё не вышли; решаем только по датам.
- Российской даты проката часто нет (Одиссея, Человек-паук, История игрушек 5…): берём самую раннюю кинопремьеру среди всех стран, как в спеке.
- Цифровые даты дырявые (у «Буратино» нет ни одной), бывают позже ожидаемого: поэтому правило 90 дней остаётся главным запасным.
- Steam по-русски: «22 окт. 2026 г.», «14 мая. 2026 г.» (с точкой), «4 квартал 2026», «Октябрь 2026», «2026», «Ещё не объявлена», «Скоро выйдет». День разбираем только из полной даты.
- RAWG: `tba: true` без даты, либо дата в будущем.

## Отклонения

- `apply_title_refresh` заодно научилась писать `season_info` (нужно BL-118 для очистки «Описания сезонов»).
- Старый ежедневный проход игр (`refreshGames`, режим `cardFixes('daily')`) удалён: его работу делает недельное обновление.
- Каждая карточка пишется отдельным вызовом (не пачкой): устаревшая карточка не тормозит остальные.
- Бюджет JS: спека говорит о бюджете **первой загрузки** (250 КБ gzip). Скрипт считал все файлы; теперь считает то, что грузит `index.html`, а фоновые проверки (`dailyRefresh` и задачи) и быстрый поиск (`QuickAdd`) грузятся отдельно. Первая загрузка 238.8 КБ (было 247.9).
