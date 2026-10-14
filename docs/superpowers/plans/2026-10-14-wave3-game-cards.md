# Волна 3. Карточки игр и источники полей: план реализации

> **Где лежат документы.** Спека: `docs/superpowers/specs/2026-10-14-review-improvements-design.md`, раздел «Волна 3». Канбан: эпик BL-E10, карточки BL-91, 92, 93 (и BL-94 в части игр).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Перед стартом:** волна 2 выложена (её `refreshJob` дозаполняет и игры). Георгий заводит ключ SteamGridDB и, если задача 1 выберет сервис с ключом, ключ переводчика; инструкцию ему готовит задача 1.

**Goal:** Карточка собирается по таблице «поле → источники по приоритету»; игры получают вертикальную обложку и русское описание; старые игры дозаполняются тем же ежедневным проходом.

**Architecture:** Провайдеры отдают сырые поля; `lib/sources.ts` хранит таблицу приоритетов и функцию сборки, которая берёт первое непустое значение. Вертикальная обложка Steam проверяется загрузкой картинки в браузере (картинкам CORS не нужен), SteamGridDB и перевод идут через Cloudflare-посредник, ключи только в посреднике (`env`), браузер их не видит. Википедия — напрямую (`origin=*`).

**Tech Stack:** как в волнах 1–2; `worker/proxy.js` (Cloudflare Workers, вставляет Георгий вручную).

**Spec:** разделы 3.1–3.5.

## Global Constraints

- Таблица источников — ровно таблица спеки 3.1; менять порядок только вместе со спекой.
- Обложка, поставленная человеком (загруженная `data:` или ссылка не из Steam/RAWG), не заменяется никогда. Заменяется только обложка, совпадающая с шаблоном шапки Steam (`/header.jpg`, `capsule_`) или RAWG (`media.rawg.io`).
- Описание заменяется только пустое или на латинице (больше 60% букв латинские).
- Пометка машинного перевода — префикс `[mt] ` в начале `synopsis` (новой колонки нет); карточка своего тайтла и карточка тайтла друга убирают префикс и показывают подпись «машинный перевод».
- Ключи посредника: `SGDB_KEY`, `TRANSLATE_KEY` (если нужен) в переменных окружения воркера, не в репозитории.
- Запросы прохода — по одному, пауза 250 мс.

## Review Focus

1. Игра без вертикальной обложки нигде: плитка показывает горизонтальную картинку целиком на размытом фоне, без обрезки и без пустоты. Тест в задаче 4.
2. Википедия нашла статью не про игру (одноимённый фильм или книга): описание не берётся. Тест в задаче 3 (статья должна содержать «игр» в первом абзаце или в названии статьи «(игра)»).
3. Посредник без ключа или лимит переводчика исчерпан: поле остаётся английским, ошибка не всплывает пользователю, проход идёт дальше. Тест в задаче 3.
4. Игра добавлена из RAWG, у неё есть Steam-версия: обложка всё равно вертикальная из SteamGridDB по названию. Тест в задаче 2.
5. Повторный проход не переписывает уже русское описание и уже вертикальную обложку. Тест в задаче 5.

---

### Task 1: Живая проверка и выбор переводчика (Remote Control)

**Files:** `app/tests/fixtures/live/games/`; раздел «Что показали живые ответы» в этом плане; `/mnt/project-files/review/cloudflare-keys.md` (инструкция Георгию).

- [ ] **Step 1:** На компьютере Георгия: для 30 игр из прода (read-only выборка `source in ('steam','rawg')`) проверить загрузку `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/<appid>/library_600x900.jpg` (и `_2x`), записать долю. Ответ SteamGridDB `/api/v2/search/autocomplete/<term>` и `/api/v2/grids/game/<id>?dimensions=600x900` (с временным ключом Георгия). Википедия: `ru.wikipedia.org/w/api.php?action=query&list=search&srsearch=<name> игра&format=json&origin=*` и `/api/rest_v1/page/summary/<title>` для 5 консольных эксклюзивов.
- [ ] **Step 2:** Выбрать переводчик: бесплатный без карты и с CORS через посредник. Кандидаты по порядку: MyMemory (ключ не нужен, лимит в день), Яндекс (нужен облачный аккаунт), DeepL Free (нужна карта). Записать решение и лимиты.
- [ ] **Step 3:** Инструкция Георгию: завести ключ SteamGridDB (и переводчика, если нужен), вставить новый `worker/proxy.js` и переменные в панели Cloudflare. Коротко, по шагам.
- [ ] **Step 4: Commit** `test: live game cover and description fixtures`.

### Task 2: Таблица источников и сборка карточки (BL-93)

**Files:** Create `app/src/lib/sources.ts`; Modify `app/src/data/enrichSearch.ts`, `app/src/lib/enrich.ts`; Test `app/tests/lib/sources.test.ts`, `app/tests/data/enrichSearch.test.ts` (создать, если нет).

**Interfaces:**
- Produces: `type Field = 'title' | 'originalTitle' | 'synopsis' | 'cover' | 'genres' | 'year' | 'parts' | 'platforms'`; `SOURCES: Record<Category, Partial<Record<Field, SourceName[]>>>` по таблице 3.1; `assemble(category, raw: Partial<Record<SourceName, Partial<Details>>>): Details` — для каждого поля первое непустое по приоритету.
- `details(hit)` в `enrichSearch.ts` собирает `raw` от нужных провайдеров параллельно и возвращает `assemble(...)`; нынешнее «Steam + RAWG платформы» удаляется как частный случай.

- [ ] **Step 1: Тесты:** пустое описание Steam → берётся следующее по таблице; платформы игры из RAWG первыми; кино не трогает игровые источники; провайдер вернул `null` → пропускается.
- [ ] **Step 2–4.** **Step 5: Commit** `feat: per-field source priority (BL-93)`.

### Task 3: Провайдеры: вертикальная обложка, Википедия, перевод (BL-91, BL-92)

**Files:** Modify `app/src/lib/enrich.ts`, `worker/proxy.js`; Test `app/tests/lib/enrich.test.ts`, `worker/proxy.test.mjs` (создать: node-тест разрешённых хостов и подстановки ключа).

**Interfaces:**
- Produces: `steamTallCover(appid, loadImage: (url) => Promise<boolean>): Promise<string | null>`; `sgdbTallCover(fetchFn, proxyBase, query: { steamAppId?: string; name: string }): Promise<string | null>`; `ruWikiSummary(fetchFn, name: string): Promise<string | null>` (с проверкой «про игру»); `translateToRu(fetchFn, proxyBase, text): Promise<string | null>`.
- Посредник: новые разрешённые хосты `www.steamgriddb.com` и хост переводчика; для `steamgriddb` добавляет `Authorization: Bearer ${env.SGDB_KEY}`; ключ переводчика — так же, если нужен. Без ключа отвечает 503, клиент это считает «нет данных».

- [ ] **Step 1: Тесты** на фикстурах задачи 1 и для посредника (запрещённый хост → 403, ключ подставлен, ключ не возвращается в ответе).
- [ ] **Step 2–4.** **Step 5: Commit** `feat: tall game covers, Russian descriptions from Wikipedia and translation (BL-91, BL-92)`.

### Task 4: Горизонтальная обложка на размытом фоне и подпись перевода

**Files:** Modify `app/src/screens/Backlog/TitleCard.tsx` + css, `app/src/screens/TitleSheet/TitleSheet.tsx` + css, `app/src/lib/covers.ts`; Test `app/tests/lib/covers.test.ts`, снимки `visual.spec.ts`.

**Interfaces:** `isLandscapeCover(url): boolean` по шаблонам Steam/RAWG; плитка с такой обложкой рисует `<img>` с `object-fit: contain` поверх той же картинки, размытой на фоне. `synopsisText(t): { text: string; machine: boolean }` снимает префикс `"[mt] "`.

- [ ] **Step 1–4:** тесты, реализация, снимки «backlog», «title» с игрой с горизонтальной обложкой. **Step 5: Commit** `feat: landscape covers fit on blur; machine translation note`.

### Task 5: Дозаполнение старых игр в ежедневном проходе (BL-94, игры)

**Files:** Modify `app/src/data/refreshJob.ts`, `app/src/lib/refresh.ts`; Test `app/tests/data/refreshJob.test.ts`.

**Interfaces:** `gameFixes(t: Title, found: { cover?: string; synopsis?: string }): Partial<Title> | null` — по правилам Global Constraints; `apply_title_refresh` расширяется полями `cover` и `synopsis` в `p_updates` (миграция `20261120000000_title_refresh_games.sql` с откатом и pgTAP).

- [ ] **Step 1: Тесты:** своя обложка не меняется; шапка Steam меняется на вертикальную; русское описание не меняется; английское меняется; повторный проход ничего не меняет.
- [ ] **Step 2–4.** **Step 5: Commit** `feat: daily refresh fills game covers and descriptions`.

### Task 5a: Разово привести перенесённые тайтлы к виду из поиска (решение Георгия 2026-10-14)

Около 20 тайтлов перенесены со старого сайта и выглядят иначе, чем добавленные из поиска. Георгий выбрал сделать их разовое приведение в волне 3.

**Что делаем:** для тайтлов всех категорий, у которых есть `source_id` (кино, сериалы, аниме, игры), разово подтянуть из источника название, обложку, описание, жанры и год, как их даёт поиск. Свою обложку, загруженную Георгием (Supabase Storage, не файл старого сайта), не трогаем. Файлы старого сайта (github.io) заменяем. Сезоны уже приводит волна 2.

**Как:** тем же тихим `apply_title_refresh` (поля из Task 5 плюс `title`, `genres`, `year`), один раз на доску (отметка в localStorage `normalize:<board>`); перед запуском read-only выборка с прода, какие тайтлы попадут, и снимок в /mnt/project-files/backups/. Тесты: своя обложка остаётся; обложка старого сайта заменяется; повторный запуск ничего не меняет.

### Task 6: Выкладка

- [ ] **Step 1:** Полная проверка, ревью ветки.
- [ ] **Step 2:** Георгий: ключи и новый посредник в Cloudflare (инструкция из задачи 1); SQL задачи 5 в SQL Editor — до слияния.
- [ ] **Step 3:** PR, CI, слияние, выкладка; проверка через Remote Control: добавить консольный эксклюзив (русское описание из Википедии), Steam-игру (вертикальная обложка); read-only запрос: сколько игр с горизонтальной обложкой осталось.
- [ ] **Step 4:** Канбан BL-91, 92, 93, 94; план; сообщение Георгию.
