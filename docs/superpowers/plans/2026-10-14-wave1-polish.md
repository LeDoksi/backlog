# Волна 1. Полировка после обзора: план реализации

> **Где лежат документы.** Спека: `docs/superpowers/specs/2026-10-14-review-improvements-design.md`, раздел «Волна 1». Задачи: канбан Supabase-проект `kanban` (`qcxfaxgqjzabtrzpsnnm`), проект `backlog`, эпик BL-E11, карточки BL-96…107. Каждую закрытую задачу отмечать в канбане (статус и чек-лист) и комментарием `claude` со ссылкой на PR.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть BL-96…107: лента и полка друга открывают карточку тайтла друга, одна плашка совпадения на тайтл, игровые слова и «Во что поиграть?», итоги в тайтлах, меню «…» и отмена удаления, строка скрытых только при наличии, своя оценка 1–10.

**Architecture:** Почти всё на клиенте (`app/src`). База меняется одной миграцией `20261101000000_review_polish.sql`: новая функция `friend_title`, в `feed` добавляются `rating` и `title_ids`, в `taste_match` добавляется близость оценок. Миграция с откатом и pgTAP, как все с фазы D. На прод её запускает Георгий в SQL Editor (облако не пишет в прод-базу): файл `/mnt/project-files/sql/2026-10-xx-wave1.sql`, одна транзакция, проверен на локальном Postgres.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Playwright; Postgres + pgTAP (`supabase/tests/support/run-local.sh`).

**Spec:** разделы 1.1–1.9.

## Global Constraints

- Тексты интерфейса на русском, без рода у глаголов о других людях («Вадим · завершено «Драйв»»), как в `data/feedFormat.ts`.
- Скрытый тайтл (`hidden`) и всё, что закрыто приватностью доски, не видно друзьям ни в одной новой функции: всё чтение чужого только через `visible_titles_for(владелец, зритель)`.
- Оценка — целое 1…10 или `null` (`lib/validate.ts` уже проверяет).
- Почта никому не отдаётся.
- Бюджет JS 250 KB gzip (`npm run budget`).
- После изменения внешнего вида переснять снимки `e2e/visual.spec.ts` и просмотреть их глазами.

## Review Focus

1. Отмена удаления, когда за 6 секунд пришла синхронизация (realtime или `applyPulled`): тайтл не должен вернуться сам и не должен потеряться после «Отменить». Тест в задаче 7.
2. Закрыли вкладку за время плашки: удаление уходит при следующем запуске, а не теряется и не висит вечно. Тест в задаче 7.
3. Тайтл друга, который тот скрыл или доска стала приватной между лентой и касанием: `friend_title` возвращает пусто, карточка пишет «Тайтл недоступен», без ошибки. Тест в задачах 1 и 2.
4. Совпадение с тремя друзьями с разными статусами: одна плашка, строка перечисляет всех, порядок «смотрит, хочет». Тест в задаче 4.
5. «Во что поиграть?», когда все игры завершены или не вышли: короткая подпись «Тут всё пройдено», а не пустое открытие. Тест в задаче 5.

---

### Task 1: База: `friend_title`, оценка и id в ленте, оценка в совпадении вкусов

**Files:**
- Create: `supabase/migrations/20261101000000_review_polish.sql`, `supabase/rollbacks/20261101000000_review_polish.sql`, `supabase/tests/friend_title.sql`
- Modify: `supabase/tests/feed.sql`, `supabase/tests/taste.sql`, `supabase/tests/privacy_matrix.sql`, `supabase/tests/grants.sql`

**Interfaces:**
- Produces: `friend_title(p_owner uuid, p_id text) returns json` — `null`, если не видно; иначе `{id, title, original_title, category, year, genres, synopsis, cover, platforms, parts, checked: int[], status, rating, title_key, mine_id}`, где `mine_id` — id моего тайтла с тем же `title_key` на любой моей доске или `null`.
- Produces: `feed(...)` получает две новые колонки в конце: `rating int` (оценка тайтла на момент чтения, только для `kind = 'completed'`, иначе `null`) и `title_ids text[]` (для `added`: id тайтлов в том же порядке, что `covers`; иначе `null`).
- Produces: `taste_match` — в доле «общие завершённые» (60%) 20% этой доли считается по оценкам: для общих завершённых, где оценка есть у обоих, `1 - avg(abs(r1 - r2)) / 9`. Если таких меньше 3, считается как раньше.

- [x] **Step 1: Тесты pgTAP.** `friend_title.sql`: друг видит тайтл друга на доске `friends`; не видит на `private`; не видит `hidden`; не-друг не видит на `friends`; видит на `everyone`; `mine_id` заполнен, когда у меня тот же `source:source_id`; почты нет в ответе. `feed.sql`: у `completed` с оценкой есть `rating`, у скрытого тайтла строки нет, у `added` из трёх тайтлов `title_ids` длины 3 и порядок как `covers`. `taste.sql`: два пользователя с 3 общими завершёнными и одинаковыми оценками получают процент выше, чем с оценками 1 и 10. Добавить `friend_title` в матрицу приватности и в проверку grants (только `authenticated`).
- [x] **Step 2:** `supabase/tests/support/run-local.sh` — новые тесты падают.
- [x] **Step 3: Миграция.** `friend_title` — `security definer`, `stable`, `search_path = public`, строка из `visible_titles_for(p_owner, auth.uid())`. `feed` пересоздаётся (`drop function` + `create`, так как меняется набор колонок; grants восстановить). Откат возвращает определения из `20261025000000_social_followups.sql` и `20261020000400_shelf_taste.sql`.
- [x] **Step 3а: Прод-скрипт.** На прод нельзя `drop function` через MCP (зависает), поэтому в скрипт для Георгия: `begin; alter function feed(...) rename to feed_before_wave1;` затем `create`, затем `insert` в `supabase_migrations.schema_migrations`, `commit;`. Сохранить в `/mnt/project-files/sql/`.
- [x] **Step 4:** `run-local.sh` — все тесты и проверка откатов зелёные.
- [x] **Step 5: Commit** `feat(db): friend_title, rating and title ids in feed, ratings in taste match`.

### Task 2: Клиент: карточка тайтла друга

**Files:**
- Create: `app/src/screens/FriendTitle/FriendTitle.tsx`, `app/src/screens/FriendTitle/FriendTitle.module.css`
- Modify: `app/src/lib/social.ts`, `app/src/data/ui.ts`, `app/src/App.tsx` (смонтировать панель рядом с `FriendProfile`), `app/src/screens/FriendProfile/FriendProfile.tsx`, `app/src/screens/FriendProfile/CopyFromFriend.tsx`
- Test: `app/tests/lib/social.test.ts`, `app/tests/screens/friendTitle.test.tsx`, `app/e2e/friend-title.spec.ts`, `app/e2e/fixtures/supabaseStub.ts`

**Interfaces:**
- Consumes: RPC `friend_title` (задача 1).
- Produces: `export interface FriendTitleData` (поля ответа задачи 1, `checked: number[]`) и `export async function friendTitle(client, owner: string, id: string): Promise<FriendTitleData | 'none' | null>` в `lib/social.ts` (`'none'` — пустой ответ, `null` — ошибка сети).
- Produces: в `useUi`: `friendTitle: { owner: string; id: string; name: string } | null`, `openFriendTitle(owner, id, name)`, `closeFriendTitle()`.
- Produces: `CopyFromFriend` переделывается в кнопочный блок `CopyButtons({ owner, id })` без собственной панели, его использует `FriendTitle`.

- [x] **Step 1: Тесты.** `social.test.ts`: `friendTitle` разбирает ответ, пустой ответ → `'none'`, ошибка → `null`. `friendTitle.test.tsx`: показывает название, описание, «Вадим · завершено, 9/10», сезоны без активных галочек (`disabled`), кнопку «Добавить к себе»; при `mine_id` вместо неё «Уже у тебя» и «Открыть мой» (вызывает `openTitle(mine_id)` и закрывает панель); `'none'` → «Тайтл недоступен».
- [x] **Step 2:** `npm test` — падают.
- [x] **Step 3: Реализация.** Вёрстка как у `TitleSheet` (тот же `Sheet`, герой с обложкой, `PartsChecklist` в режиме только чтения — добавить ему проп `readOnly`). Строка статуса: `${name} · ${statusWord(status, category)}` и `, ${rating}/10` при оценке. Кнопки копирования — `CopyButtons`. В `FriendProfile` касание плитки вызывает `openFriendTitle(friend.id, t.id, friend.name)` вместо `setPicked`; надпись «общее» на плитке остаётся.
- [x] **Step 4: e2e.** `friend-title.spec.ts`: с полки друга касание тайтла открывает карточку, «Добавить к себе» зовёт `copy_from_friend`; «Назад» закрывает карточку и оставляет профиль друга. Стаб: `friend_title` по опции `friendTitles: Record<string, Row>` (ключ `${owner}:${id}`).
- [x] **Step 5:** `npm test && npm run typecheck && npx playwright test e2e/friend-title.spec.ts e2e/copy-from-friend.spec.ts` — зелёные.
- [x] **Step 6: Commit** `feat: friend's title card with add-to-mine (BL-98)`.

### Task 3: Лента: перенос текста и касание открывает тайтл (BL-96, BL-97)

**Files:**
- Modify: `app/src/screens/Friends/FeedItem.tsx`, `app/src/screens/Friends/Friends.module.css`, `app/src/screens/Friends/Friends.tsx`, `app/src/data/feedFormat.ts`
- Test: `app/tests/data/feedFormat.test.ts`, `app/e2e/feed.spec.ts`

**Interfaces:**
- Consumes: `openFriendTitle` (задача 2), новые поля `rating`, `title_ids` в `FeedRow` (`rating: number | null`, `title_ids: string[] | null`).

- [x] **Step 1: Тесты.** `feedFormat.test.ts`: `feedText` для `completed` с оценкой 9 → `завершено «Драйв» · 9/10`, без оценки как раньше. `feed.spec.ts`: запись с названием на 120 символов не шире карточки (`boundingBox` текста правее левого края обложки нет пересечения) на телефоне; касание записи `completed` открывает диалог с названием тайтла; касание имени открывает профиль друга; касание второй обложки в «+5 тайтлов» открывает карточку второго `title_ids`.
- [x] **Step 2:** падают.
- [x] **Step 3: Реализация.** Строка записи — сетка `avatar | text (minmax(0,1fr)) | cover`, у текста `overflow-wrap: anywhere` и обрезка на трёх строках (`-webkit-line-clamp: 3`). Корневой элемент записи становится `div`; внутри отдельные кнопки: имя+аватар (профиль), текст+обложка (тайтл), обложки ленты (по одной кнопке на обложку). `aria-label` у кнопок сохраняет нынешний текст для доступности.
- [x] **Step 4:** `npm test`, `npx playwright test e2e/feed.spec.ts e2e/friend-profile.spec.ts e2e/a11y.spec.ts` — зелёные.
- [x] **Step 5: Commit** `fix: feed lines wrap; a tap opens the title (BL-96, BL-97)`.

### Task 4: Совпадения: одна плашка на тайтл (BL-99, BL-100)

**Files:**
- Modify: `app/src/screens/Friends/Matches.tsx`, `app/src/screens/Friends/Matches.module.css`, `app/src/data/friendsOn.ts`
- Test: `app/tests/data/friendsOn.test.ts`, `app/e2e/matches.spec.ts`

**Interfaces:**
- Produces: `export interface MatchGroup { title_key: string; title: string; category: string; cover: string | null; my_status: string; friends: { id: string; name: string; status: string }[] }`, `groupMatches(rows: Match[]): MatchGroup[]` (порядок групп — по первому появлению, друзья внутри — `byPriority`), `matchGroupText(g: MatchGroup): string`.

- [x] **Step 1: Тесты.** `groupMatches` из двух строк одного `title_key` даёт одну группу с двумя друзьями; `matchGroupText` для «Вадим in_progress, Лёша queue, кино» → `Вадим смотрит, Лёша хочет`; для игры → `Вадим играет, Лёша хочет`; один друг и я `in_progress` → `Ты и Вадим оба смотрите`. e2e: два совпадения одного тайтла → одна плашка, слова «Совпадение» на странице нет, касание открывает мою карточку тайтла (`openTitle` по `title_key` → мой id; найти тайтл в `useTitles` по `titleKey`).
- [x] **Step 2:** падают.
- [x] **Step 3: Реализация.** Плашка: обложка, название, строка `matchGroupText`, ряд мини-`Avatar` (до 3 и «+N»). Счётчик вкладки «Совпадения N» считает группы.
- [x] **Step 4:** зелёные (`npm test`, `npx playwright test e2e/matches.spec.ts`).
- [x] **Step 5: Commit** `feat: one match card per title (BL-99, BL-100)`.

### Task 5: Игры: «играет», вкладка «В процессе», «Во что поиграть?» (BL-101, BL-107)

**Files:**
- Modify: `app/src/data/randomPick.ts`, `app/src/screens/Backlog/FilterChips.tsx`, `app/src/screens/FriendProfile/FriendProfile.tsx`, `app/src/data/feedFormat.ts`, `app/src/screens/TitleSheet/FriendsOnTitle.tsx` (проверить глаголы)
- Test: `app/tests/data/randomPick.test.ts`, `app/tests/data/feedFormat.test.ts`, `app/e2e/backlog.spec.ts`

**Interfaces:**
- Produces: `randomCandidates(titles, category, checked)` — при `category === 'game'` берёт игры (не `done`, не `unreleased`); при любой другой вкладке игры исключены, как сейчас. `randomLabel(category): 'Во что поиграть?' | 'Что посмотреть?'`, `randomEmpty(category): 'Тут всё пройдено' | 'Тут всё посмотрено'`.

- [x] **Step 1: Тесты.** `randomPick.test.ts`: на `game` выбирается только незавершённая вышедшая игра; на `all` игра не выбирается никогда; пусто на `game` → `null`. `feedFormat.test.ts`: `started` для игры → `начато «Ведьмак 3»` остаётся (без рода), но в «У друзей» и совпадениях `играет`. e2e: на вкладке «Игры» кнопка называется «Во что поиграть?» и открывает игру; вкладка полки друга называется «В процессе».
- [x] **Step 2:** падают.
- [x] **Step 3: Реализация.** Убрать `aria-disabled`/«Игры не смотрят» из `FilterChips`. `TABS` в `FriendProfile`: `{ value: 'watching', label: 'В процессе' }`.
- [x] **Step 4:** зелёные.
- [x] **Step 5: Commit** `feat: games pick and wording (BL-101, BL-107)`.

### Task 6: Итоги в тайтлах, сезоны второй строкой (BL-102)

**Files:**
- Modify: `app/src/data/stats.ts`, `app/src/screens/Stats/Stats.tsx`, `app/src/screens/Stats/Stats.module.css`, `app/src/screens/Stats/Leaderboard.tsx`
- Test: `app/tests/data/stats.test.ts`, `app/e2e/visual.spec.ts` (переснять «stats»)

**Interfaces:**
- Produces: `byCategory[c].done` для сериалов и аниме — число завершённых тайтлов (уже есть), `seasons` — отмеченные сезоны (уже есть). Плитка: `{ n: done, label: plural(done, 'сериал','сериала','сериалов'), sub: seasons > 0 ? `${seasons} ${plural(seasons,'сезон','сезона','сезонов')}` : null }`, для аниме `label` всегда «аниме».

- [x] **Step 1: Тест** (`stats.test.ts`): завершённый аниме-фильм без чек-листа даёт `anime.done = 1` и `anime.seasons = 0` (раньше давал 1 сезон: решение спеки 1.6, сезоны — только отмеченные части); сериал с 3 отмеченными сезонами из 4 даёт `series.done = 0`, `series.seasons = 3`.
- [x] **Step 2:** падает.
- [x] **Step 3: Реализация.** В `computeStats` и `periodStats` убрать `: t.status === 'done' ? 1 : 0` для тайтлов без чек-листа. Сноска лидеров: «Личные и общие доски считаются отдельно. В кино и играх считаем завершённые, в сериалах и аниме отмеченные сезоны.» (SQL лидеров не трогаем.)
- [x] **Step 4:** зелёные; переснять снимок stats и посмотреть.
- [x] **Step 5: Commit** `feat: stats tiles count titles, seasons below (BL-102)`.

### Task 7: Меню «…» в карточке и отмена удаления (BL-104, BL-105)

**Files:**
- Modify: `app/src/screens/TitleSheet/TitleSheet.tsx`, `app/src/screens/TitleSheet/TitleSheet.module.css`, `app/src/data/titlesStore.ts`, `app/src/data/ui.ts`, `app/src/ui/Toast.tsx`, `app/src/ui/Toast.module.css`, `app/src/data/syncEngine.ts` (досылка зависшего удаления при старте)
- Test: `app/tests/data/titlesStore.test.ts`, `app/e2e/backlog.spec.ts` (удаление), `app/e2e/edit.spec.ts` если там есть удаление

**Interfaces:**
- Produces: в `TitlesState`: `deleteTitle(id): void` (теперь откладывает отправку), `undoDelete(): boolean`, `commitPendingDelete(): void`; хранение отложенного удаления в `storage` под ключом `pending-delete` (`{ board, id, row, at }`).
- Produces: в `useUi.toast` вместо `string | null` — `{ text: string; action?: { label: string; run(): void } } | null`; `showToast(text, action?)`. Все существующие вызовы `showToast(text)` работают без изменений.

- [x] **Step 1: Тесты** (`titlesStore.test.ts`, фейковые таймеры): `deleteTitle` убирает тайтл из `titles`, но в outbox ничего нет; через 6000 мс в outbox `delete`; `undoDelete` до 6000 мс возвращает тайтл с прежними `checked`, `status`, `rating`, `completedAt`, outbox пуст; `applyPulled` с сервера, где тайтл ещё есть, пока удаление отложено, не возвращает его; новый store, созданный с `pending-delete` в storage старше 6 с, сразу ставит `delete` в outbox; второе удаление, пока первое ждёт, сразу отправляет первое.
- [x] **Step 2:** падают.
- [x] **Step 3: Реализация.** Футер `TitleSheet`: «Редактировать» и кнопка `aria-label="Ещё"` (`DotsThree`), под ней меню из двух пунктов как в `FriendProfile` («Скрыть от друзей»/«Показать друзьям», «Удалить» красным). «Удалить» закрывает панель, вызывает `deleteTitle` и `showToast(`Удалено «${title}»`, { label: 'Отменить', run: undoDelete })`. `Confirm` из карточки убрать. Тост с действием: текст и отдельная кнопка «Отменить»; таймер тоста 6000 мс уже есть; по истечении — `commitPendingDelete()`.
- [x] **Step 4:** `npm test`, e2e удаления и `a11y` зелёные; переснять снимок «title».
- [x] **Step 5: Commit** `feat: title menu and undo delete (BL-104, BL-105)`.

### Task 8: Профиль: «Скрытые тайтлы» только при наличии (BL-106)

**Files:** Modify `app/src/screens/Profile/Profile.tsx`. Test: `app/e2e/profile.spec.ts`.

- [x] **Step 1: Тест e2e:** без скрытых строки «Скрытые тайтлы» нет; со скрытым (стаб `my_hidden_titles` вернул 1) строка есть и показывает 1.
- [x] **Step 2:** падает. **Step 3:** рендерить строку при `hiddenCount !== null && hiddenCount > 0`. **Step 4:** зелёный; переснять «profile».
- [x] **Step 5: Commit** `feat: hidden titles row only when there are some (BL-106)`.

### Task 9: Своя оценка 1–10 (BL-103)

**Files:**
- Create: `app/src/screens/TitleSheet/RatingControl.tsx`, `app/src/screens/TitleSheet/RatingControl.module.css`
- Modify: `app/src/screens/TitleSheet/TitleSheet.tsx`, `app/src/screens/Backlog/TitleCard.tsx`, `app/src/data/titlesStore.ts`
- Test: `app/tests/screens/ratingControl.test.tsx`, `app/tests/data/titlesStore.test.ts`, `app/e2e/backlog.spec.ts`

**Interfaces:**
- Produces: `RatingControl({ value: number | null; prompt: boolean; onChange(v: number | null): void })`; `setRating(id: string, v: number | null): void` в `TitlesState` (пишет колонку `rating` через `patch`).

- [x] **Step 1: Тесты.** `RatingControl`: 10 кнопок `role="radio"` в `radiogroup` «Оценка», касание 7 → `onChange(7)`, повторное касание 7 → `onChange(null)`; при `prompt` заголовок «Как тебе?», иначе «Оценка». `titlesStore`: `setRating` ставит op `update` с `{ rating: 7 }`. e2e: завершить тайтл → строка «Как тебе?» видна, поставить 8 → на плитке в бэклоге видно «8».
- [x] **Step 2:** падают.
- [x] **Step 3: Реализация.** `prompt = title.status === 'done' && title.rating == null`. Блок показывается для всех статусов, кроме `unreleased`, под `StatusControl`/`PartsChecklist`. На плитке оценка — после года: «Кино, 2011 · 8».
- [x] **Step 4:** зелёные; переснять «title», «backlog».
- [x] **Step 5: Commit** `feat: personal 1-10 rating (BL-103)`.

### Task 10: Выкладка волны 1

- [ ] **Step 1:** Вся проверка: `cd app && npm test && npm run typecheck && npm run build && npm run budget && npm run e2e`; `supabase/tests/support/run-local.sh`.
- [ ] **Step 2:** Ревью ветки (`superpowers:requesting-code-review` или `code-review` high), исправить находки.
- [ ] **Step 3:** Прод-скрипт задачи 1 проверить на копии схемы прода (как в `2026-10-02-close-redesign.sql`) и положить в `/mnt/project-files/sql/`. Попросить Георгия запустить его в SQL Editor **до** слияния (клиент без `friend_title` и новых колонок ленты сломает ленту). После запуска проверить read-only запросом, что функции на месте.
- [ ] **Step 4:** PR, CI зелёный, слияние, выкладка. Отметить BL-96…107 в канбане, план — галочки и раздел «Отклонения при реализации», если были.
- [ ] **Step 5:** Сообщение Георгию: что попробовать (лента, полка друга, совпадения, «Во что поиграть?», итоги, «…» и «Отменить», оценка).

## Отклонения при реализации

- **Прод-скрипт** (`/mnt/project-files/sql/2026-10-14-wave1.sql`) кроме переименования старой `feed` в `feed_before_wave1` ещё закрывает её от `authenticated`. Георгий запустил его 2026-10-14 до слияния; проверено запросом только для чтения: миграция `20261101000000` записана, `friend_title` только для вошедших, новая `feed` с `rating` и `title_ids`.
- **Тест ленты** проверяет `title_ids` на существующей записи из 12 добавлений (а не из трёх): свойство то же.
- **Лента (задача 3):** касание всей записи — пустая кнопка под текстом во всю карточку (подпись прежняя), а имя, аватар и обложки ленты — отдельные кнопки поверх. Инлайн-кнопка вокруг текста не умеет переноситься и выталкивала текст за обложку. Обложки ленты «+N тайтлов» подписаны «Обложка N из M»: названий этих тайтлов в ленте нет. `FeedItem` сам открывает профиль и карточку, у `FeedList` и `FriendsColumn` больше нет `onOpen`.
- **e2e карточки друга** входят в профиль друга по кнопке имени в ленте из задачи 3, поэтому прогнаны после неё. Заглушка `friend_title` без записи в `friendTitles` отвечает строкой с полки.
- **Совпадения:** один друг, который тоже просто хочет, пишется «Вадим хочет» (без «оба хотите»); старый `matchText` удалён. Если моего тайтла с этим ключом нет на доске, плашка открывает профиль первого друга.
- **Игры:** игровые глаголы и на своих карточках, в статусе и быстром меню («Играю» вместо «Смотрю»), а в итогах «Смотришь N» стало «В процессе N» (спека 1.5: «везде, где речь об игре»).
- **Отмена удаления:** таймер окна отмены живёт в хранилище тайтлов, а не в тосте; ждущее удаление отправляется при любом следующем запуске (после перезагрузки отменять уже не из чего); выход из аккаунта сначала отправляет ждущее удаление.
- **Оценка:** подпись карточки для экранного диктора говорит «оценка N».
- **Снимки** пересняты один раз в конце (stats, title, friends, genres, edit, profile) и просмотрены.
- **После финального ревью:** окно отмены 7 с (тост 6 с плюс исчезание), чтобы «Отменить» в последний момент не терялось; синхронизация, повторяющая офлайн-добавление, больше не возвращает ждущий удаления тайтл; «Открыть мой» показывается, только если мой экземпляр на открытой сейчас доске (иначе «Уже у тебя на другой доске»).
- **Отложено на волну 2:** `friend_title(владелец, id)` берёт строку через `visible_titles_for`, где один тайтл на ключ (личная копия важнее общей). Если у друга один фильм и на личной, и на общей доске под разными id, запись ленты с общей доски откроет «Тайтл недоступен». Починка требует доски в аргументах и нового SQL-скрипта; волна 2 и так склеивает дубли и несёт SQL для Георгия.
- **Сверка с дизайн-системой** (напоминание Георгия): кнопки оценки стали капсулами 44px, по пять в ряд на телефоне и по десять на десктопе (десять в ряд на телефоне давали меньше 44px), анимируется только `transform`; меню «Ещё» собрано на общем `Popover` (новые параметры `side="above"` и `className`), поэтому закрывается касанием мимо, а Esc закрывает только меню, не панель тайтла.
- **Снимки и CI:** раннер CI хинтует шрифты, контейнер нет, из-за этого текст на телефоне переносился по-разному. Браузер в e2e теперь запускается с `--font-render-hinting=none` (playwright.config.ts). При падении CI выкладывает `test-results` артефактом.
- **Доработка после выкладки (замечания Георгия 2026-10-14):** ряд обложек в записи «добавлено N тайтлов» листается вбок, а тап по записи открывает панель только с этими тайтлами (`FeedBatch`: обложка, название, категория и год; тап открывает карточку тайтла, внизу «Вся полка «Хочет»»), только клиент, через `friend_title` для каждого id. Строки ленты стали понятнее: «просмотрено 2 сезона «Фрирен»» (у игр «пройдено»), «добавлено 10 тайтлов», «завершено «X» · оценка 9/10». Оценка в одну строку, как сегментированный переключатель. Плашка «Не сохранено» появляется, только если правка не дошла за 4 с: на каждой правке она мигала, пока шёл запрос, хотя всё сохранялось.
