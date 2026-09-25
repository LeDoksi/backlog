# C. Редизайн ядра на текущей схеме — план реализации

> **Где лежат документы (для любой сессии, в том числе локальной).** Спека, планы, дизайн-система и макеты закоммичены в ветку **`claude/loving-rubin-mh121x`** репозитория `LeDoksi/backlog`. Пока она не слита в `master`, работать нужно от неё:
> ```bash
> git fetch origin claude/loving-rubin-mh121x
> git checkout claude/loving-rubin-mh121x
> ```
> Если ветка уже слита, те же файлы лежат в `master`, берите оттуда. Задачи и порядок работ — в канбане: Supabase-проект `kanban` (`qcxfaxgqjzabtrzpsnnm`), проект `backlog`, эпики BL-E5…BL-E8.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Перед стартом:** запустить `superpowers:writing-plans` для этого подпроекта и развернуть каждую задачу ниже в шаги по 2–5 минут (тест → падение → код → прохождение → коммит) против кода, который оставил подпроект A. Задачи, интерфейсы, критерии приёмки и ключевой код ниже обязательны; их менять нельзя без владельца.

**Goal:** Все экраны бэклога в дизайне A+C поверх текущих таблиц (`drafts`, `overrides`, `parts`), полный паритет с v1, затем v2 заменяет v1 в корне сайта, v1 и мёртвый код удаляются.

**Architecture:** Стор Zustand поверх перенесённых `storage.ts` и `sync.ts` (зеркало в `localStorage` с префиксом `bl2:`, очередь, realtime). Экраны — функциональные компоненты в `app/src/screens/`, стили CSS Modules на токенах. Переход «карточка → панель» через `layoutId` Motion.

**Tech Stack:** как в A.

**Spec:** [`../specs/2026-09-25-redesign-social-design.md`](../specs/2026-09-25-redesign-social-design.md), разделы 4.3, 4.4, 5, 6.1–6.8, 6.11, 6.12, 9, 10. Макеты: [`../../design/2026-09-25-redesign/mockups/`](../../design/2026-09-25-redesign/mockups/).

## Global Constraints

Все пункты [индекса](2026-09-25-redesign-social-plan.md#global-constraints), плюс:
- Схема: разрешено только добавить в `drafts` необязательные колонки `source text`, `source_id text` (C7). Больше ничего.
- Вкладка «Друзья», колонка «У друзей», переключатель досок, «Скрыть от друзей», «Копировать в …» в C **не показываются** (появятся в B и D).
- Понятие «черновик» в интерфейсе отсутствует. Поле `draft` при чтении игнорируется, при записи новых тайтлов пишется `false`.
- Каждый экран сверяется с макетом в обеих темах на 390×844 и 1440×900 (скриншот-тест, C13).

## Review Focus

1. Отложенная пересортировка и отложенное применение чужой правки, пока открыта панель или форма (как в v1): иначе карточка «убегает» из-под пальца. Тест: C1.
2. Долгое нажатие не должно открывать панель тайтла после себя и не должно мешать прокрутке сетки. Тест: e2e C5.
3. Добавление с клавиатурой на iPhone (BL-25). Тест: e2e C8.
4. Офлайн: правка без сети видна сразу, уходит при появлении сети, индикатор честный. Тест: C1 + e2e C12.
5. Переключение v2 в корень не оставляет старый воркер и старые кэши. Проверка: C14.

---

### Task C1: Стор тайтлов и синхронизация на текущей схеме

**Files:** Create `app/src/data/titlesStore.ts`, `app/src/data/syncEngine.ts`, `app/src/data/busy.ts`; Test `app/tests/data/titlesStore.test.ts`, `syncEngine.test.ts`.

**Interfaces:**
- Consumes: `storage.ts`, `sync.ts`, `prefixedStorage`, `getSupabase` (A).
- Produces:
  ```ts
  interface TitlesState {
    titles: Title[];                // effective: added + overlay + derived status
    loading: boolean;
    pending: number;                // outbox length
    online: boolean;
    setStatus(id: string, status: Status): void;
    setPartChecked(id: string, index: number, checked: boolean): void;
    setAllReleasedChecked(id: string): void;
    addTitle(t: Title): 'ok' | 'duplicate';
    editTitle(id: string, patch: Partial<Title>): void;   // only changed fields
    deleteTitle(id: string): void;
  }
  export const useTitles: UseBoundStore<StoreApi<TitlesState>>;
  export function startSync(): () => void;                 // pull → subscribe → online/offline listeners
  export const busy: { enter(reason: string): void; leave(reason: string): void; isBusy(): boolean };
  ```
- Правило: запись в зеркало → немедленный пересчёт `titles` → отправка через `sync.ts` (очередь при ошибке). Входящие изменения, пока `busy.isBusy()`, применяются к зеркалу, но `titles` пересчитывается только на `busy.leave`.

**Key code:**
```ts
// app/src/data/titlesStore.ts (core of the recompute)
const store = prefixedStorage(localStorage, 'bl2:');
function compute(): Title[] {
  return Storage.applyOverlay(Storage.getAdded(store), store) as Title[];
}
```

**Acceptance tests (Vitest, fake storage + fake client из `tests/lib/sync.test.ts`):**
- `setStatus` сразу меняет `titles`, пишет override и вызывает `pushOverride`; при ошибке сети растёт `pending`.
- `addTitle` с существующим `slug-year` возвращает `'duplicate'` и ничего не пишет.
- `editTitle` отправляет только изменённые поля.
- Входящее изменение при `busy.enter('sheet')` не меняет `titles` до `busy.leave('sheet')`.
- `startSync` сначала разбирает очередь, потом тянет состояние (порядок вызовов на фейковом клиенте).

---

### Task C2: Экран «Бэклог» на телефоне

**Files:** Create `app/src/screens/Backlog/Backlog.tsx`, `BacklogHeader.tsx`, `CategoryTabs.tsx`, `FilterChips.tsx`, `TitleGrid.tsx`, `TitleCard.tsx` + css; `app/src/data/filters.ts`; Test `app/tests/data/filters.test.ts`, `app/e2e/backlog.spec.ts`.

**Mockups:** `ACGrid.dc.html`, `ACGridDark.dc.html`, `ACEmpty.dc.html`.

**Interfaces:**
- Produces:
  ```ts
  interface FilterState { category: 'all' | Category; statuses: Status[]; genres: string[]; stillAiring: boolean; hideDone: boolean; search: string; sort: 'status' | 'added' | 'name' | 'year' }
  export const useFilters: UseBoundStore<StoreApi<FilterState & { set(p: Partial<FilterState>): void; reset(): void }>>;
  export function visibleTitles(titles: Title[], f: FilterState): Title[];   // wraps query.ts
  export function categoryCounts(titles: Title[]): Record<'all' | Category, { done: number; total: number }>;
  ```
- Состояние фильтров хранится в `bl2:filters` (как вкладка и сортировка в v1 не хранились, это новое удобство; при ошибке чтения — значения по умолчанию).

**Поведение:** шапка из двух рядов + ряд чипов (спека 6.2); поиск раскрывается в шапке, задержка 200мс; сетка 2 колонки, `loading="lazy"` и `decoding="async"` у постеров, `onError` → заглушка; скелетоны при `loading`; пустая доска → `EmptyState` «Здесь пока пусто»; пустой фильтр → «Ничего не нашлось» + «Сбросить фильтры»; подпись результата для экранной читалки (`aria-live="polite"`: «Показано N тайтлов»).

**Acceptance:** Vitest — `visibleTitles` повторяет `matchesFilters`/`matchesSearch`/`sortTitles` из v1 на наборе из `data.js` (50 случайных комбинаций фильтров сравниваются с v1-логикой); e2e — 6 карточек видны, вкладка «Аниме» показывает только аниме и число совпадает с `categoryCounts`, поиск «Фрир» оставляет Фрирен.

---

### Task C3: Фильтры, жанры, сортировка; десктопный тулбар в три уровня

**Files:** Create `app/src/screens/Backlog/FiltersSheet.tsx`, `GenresSheet.tsx`, `SortControl.tsx`, `DesktopToolbar.tsx` + css; Test `app/e2e/filters.spec.ts`.

**Mockups:** `ACGenres.dc.html`, `ACDesktop.dc.html` (ряды 1–3).

**Поведение:** чип «Жанры» → `GenresSheet` (телефон: `Sheet`; десктоп ≥1024: всплывающая панель у чипа), мультивыбор, «Сбросить / Показать N»; последний чип «Фильтры» с числом активных → `FiltersSheet`: статусы (чипы), «Ещё выходит», «Скрыть завершённое», сортировка (`Segmented`); на десктопе сортировка справа в третьем ряду («N тайтлов» + кнопка сортировки со всплывающим списком из 4 вариантов, не `<select>`).

**Acceptance (e2e):** выбор двух жанров показывает объединение; «Показать N» совпадает с числом карточек после закрытия; на 1440 три ряда управления не переносятся и не перекрываются (проверка bounding boxes).

---

### Task C4: Панель тайтла

**Files:** Create `app/src/screens/TitleSheet/TitleSheet.tsx`, `StatusControl.tsx`, `PartsChecklist.tsx`, `TitleActions.tsx` + css; Test `app/tests/screens/PartsChecklist.test.tsx`, `app/e2e/title-sheet.spec.ts`.

**Mockups:** `ACSheet.dc.html`, `ACSheetDark.dc.html`, десктоп — модалка 880px (спека 5).

**Interfaces:**
- Consumes: `useTitles`, `busy`, `Sheet`, `Segmented`.
- Produces: `openTitle(id: string)` в `app/src/data/ui.ts` (стор UI: `openTitleId`, `editTitleId`, `quickAddOpen`).

**Поведение:** фон — размытый постер; постер общий элемент с карточкой (`layoutId={'poster-' + id}`, spring 260/26, выключено при reduced motion); `StatusControl` из 3 сегментов, у тайтлов с частями вместо него прогресс «Просмотрено X из Y, впереди ещё Z» и `PartsChecklist` (невышедшие неактивны, дата), «Отметить все вышедшие» (скрыта, если нечего отмечать); синопсис, описание сезонов, платформы; действия: «Редактировать» (inverse), «Удалить» (danger, подтверждение «Удалить «Название»? Это нельзя отменить.»). Пока панель открыта — `busy.enter('sheet')`.

**Acceptance:** Vitest — отметка части пересчитывает статус по правилам `deriveStatus` (4 случая из README v1); e2e — смена статуса видна на карточке после закрытия, удаление убирает карточку, «Назад» браузера закрывает панель.

---

### Task C5: Быстрый статус с карточки

**Files:** Create `app/src/screens/Backlog/QuickStatus.tsx`, `app/src/ui/useLongPress.ts`; Test `app/tests/ui/useLongPress.test.ts`, `app/e2e/quick-status.spec.ts`.

**Interfaces:** `useLongPress(onLongPress: () => void, { ms = 500, moveTolerance = 10 })` → обработчики pointer-событий; отменяется при сдвиге пальца больше 10px (прокрутка) и не даёт `click` после срабатывания.

**Поведение:** телефон — долгое нажатие показывает над постером три статуса (стекло, как `hover`-блок в `ACDesktop.dc.html`), `navigator.vibrate?.(10)`; десктоп — тот же блок по наведению и по фокусу с клавиатуры; для тайтлов с частями — «Отметить все вышедшие» и «Открыть сезоны»; дубль для доступности — кнопка «⋯» на карточке (видна при фокусе и в экранной читалке) открывает то же меню.

**Acceptance:** Vitest — таймер 500мс вызывает колбэк, сдвиг на 11px отменяет; e2e (phone) — долгое нажатие + выбор «Завершено» меняет плашку и не открывает панель; обычный тап открывает панель.

---

### Task C6: «Что посмотреть?»

**Files:** Create `app/src/data/randomPick.ts`; Modify `FilterChips.tsx`; Test `app/tests/data/randomPick.test.ts`.

**Key code:**
```ts
import { isCaughtUp, getCheckedParts } from '../lib/storage';
import { pickRandom } from '../lib/query';

export function randomCandidates(titles: Title[], category: 'all' | Category, store: StorageLike): Title[] {
  return titles.filter((t) =>
    (category === 'all' || t.category === category) &&
    t.category !== 'game' && t.status !== 'done' && t.status !== 'unreleased' &&
    !isCaughtUp(t, getCheckedParts(store, t.id)));
}
export function pickNext(titles: Title[], category: 'all' | Category, store: StorageLike): Title | null {
  return pickRandom(randomCandidates(titles, category, store)) ?? null;
}
```

**Поведение:** чип открывает панель выбранного тайтла; на вкладке «Игры» чип `aria-disabled` с подсказкой «Игры не смотрят»; пустой пул → чип на 1.8с меняет подпись на «Тут всё посмотрено».

**Acceptance:** тесты: досмотренная до конца вышедшего Фрирен не попадает в кандидаты; игры не попадают; `unreleased` не попадает; фильтры (жанры, поиск) на пул не влияют.

---

### Task C7: Редактирование тайтла

**Files:** Create `app/src/screens/EditTitle/EditTitle.tsx`, `CoverField.tsx`, `GenresField.tsx`, `PartsEditor.tsx` + css; `app/src/lib/imageDownscale.ts`; `supabase/migrations/20260926000000_drafts_source.sql`; Test `app/tests/screens/EditTitle.test.tsx`, `app/tests/lib/imageDownscale.test.ts`.

**Mockups:** `ACEdit.dc.html`.

**SQL (единственное изменение схемы в C):**
```sql
alter table public.drafts add column if not exists source text;
alter table public.drafts add column if not exists source_id text;
```
В `sync.ts` добавить `source`, `sourceId` → `source`, `source_id` в поля `drafts` (только v2; v1 их не знает и при своих частичных upsert не затирает).

**Поведение:** полноэкранная форма из карточек; обложка: «Загрузить фото» (уменьшение до 900px по длинной стороне, JPEG 0.82, апскейла нет, как Task 41 v1) и «По ссылке»; жанры чипами с «+ жанр» (ввод + Enter); части: строки с названием, годом, «вышел / не вышел», удаление, «+ Добавить часть», перестановка перетаскиванием (`Reorder` из Motion); «Ещё не вышло» у тайтлов без частей; «Отмена / Сохранить» закреплены вне прокрутки; уход с изменениями → «Отменить изменения?»; сохраняются только изменённые поля; ошибки под полем (`role="alert"`). Пока форма открыта — `busy.enter('edit')`.

**Acceptance:** Vitest — неизменённая форма не вызывает `editTitle`; изменение одного поля отправляет патч из одного поля; смена категории на «Кино» прячет поля частей; `imageDownscale` не увеличивает маленькие картинки; e2e — правка названия видна на карточке.

---

### Task C8: Добавление тайтла (BL-18, BL-25)

**Files:** Create `app/src/screens/QuickAdd/QuickAdd.tsx`, `ResultRow.tsx`, `app/src/data/enrichSearch.ts`, `app/src/ui/useVisualViewport.ts` + css; Test `app/tests/data/enrichSearch.test.ts`, `app/e2e/quick-add.spec.ts`.

**Mockups:** `ACQuickAdd.dc.html`.

**Interfaces:**
```ts
export function providerFor(category: Category): 'tmdb-movie' | 'tmdb-tv' | 'shikimori' | 'steam';
export function search(category: Category, query: string, signal: AbortSignal): Promise<Candidate[]>;  // Steam → RAWG fallback, TMDb via CORS_PROXY
export function details(c: Candidate): Promise<Partial<Title> & { source: string; sourceId: string }>;
export function useVisualViewport(): { height: number; offsetTop: number };  // window.visualViewport with resize/scroll listeners
```

**Key code (BL-25):**
```ts
export function useVisualViewport() {
  const read = () => ({ height: window.visualViewport?.height ?? window.innerHeight, offsetTop: window.visualViewport?.offsetTop ?? 0 });
  const [vv, setVv] = useState(read);
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const on = () => setVv(read());
    v.addEventListener('resize', on);
    v.addEventListener('scroll', on);
    return () => { v.removeEventListener('resize', on); v.removeEventListener('scroll', on); };
  }, []);
  return vv;
}
```
Панель добавления позиционируется `top: offsetTop + 44px`, `max-height: height - 56px`, список результатов прокручивается внутри, поле ввода всегда сверху панели.

**Поведение:** категория сначала (4 сегмента, по умолчанию «Кино»), поле с фокусом, поиск от 2 символов с задержкой 350мс и отменой предыдущего запроса; до 5 результатов; «+» добавляет сразу (с `source`, `sourceId`), поле очищается, фокус остаётся; «Нет нужного? Добавить “…” вручную»; дубль → «Этот тайтл уже есть в бэклоге»; без сети/ключа — короткое сообщение, ручное добавление работает.

**Acceptance (e2e phone):** эмуляция клавиатуры (уменьшить `visualViewport` до 554px через CDP `Emulation.setVisibleSize` или `page.setViewportSize({ width: 390, height: 554 })` после фокуса) — поле ввода и первая строка результатов целиком внутри видимой области без прокрутки; сетевые ответы провайдеров подменены фикстурами.

---

### Task C9: Итоги (личные, «всё время»)

**Files:** Create `app/src/screens/Stats/Stats.tsx`, `app/src/data/stats.ts` + css; Test `app/tests/data/stats.test.ts`.

**Mockups:** `ACStats.dc.html`, `ACStatsDesktop.dc.html` (без лидерборда и без переключателя периода).

**Interfaces:** `computeStats(titles: Title[], checkedParts: (id: string) => number[]): { done: number; total: number; waiting: number; byCategory: Record<Category, { done: number; seasons?: number }>; genres: { genre: string; count: number }[] }`. `seasons` у сериалов и аниме — число отмеченных частей по всем тайтлам; `waiting` — `isCaughtUp`.

**Acceptance:** Vitest на наборе из `data.js`: сумма по категориям равна `done`; топ жанров отсортирован по убыванию; числа совпадают с панелью «Итоги» v1 для тех же данных.

---

### Task C10: Профиль (текущие функции)

**Files:** Create `app/src/screens/Profile/Profile.tsx`, `MembersSheet.tsx`, `InviteSheet.tsx` + css; Test `app/e2e/profile.spec.ts`.

**Mockups:** `ACProfile.dc.html` (блок досок в C заменён на «Пригласить по email» и «Участники»).

**Поведение:** аватар (из `email` до появления имени), «Оформление» (`Segmented` «Светлая / Тёмная / Как в системе» → `setTheme`), «Пригласить по email» (форма email + «Добавить в моё пространство», RPC `invite_email`), «Участники» (список `listWorkspaceMembers`, «Выйти» у себя, «Удалить» у других, всё с подтверждением; пункт скрыт, если участник один), «Выйти из аккаунта» (очистка зеркала `bl2:*` и выход).

**Acceptance (e2e):** смена темы меняет `data-theme` и переживает перезагрузку; приглашение вызывает RPC с правильными аргументами (заглушка записывает вызовы).

---

### Task C11: Десктопная раскладка

**Files:** Modify `Backlog.tsx`, `TitleSheet.tsx`, `AppShell` css; Create `app/src/ui/Popover.tsx`; Test `app/e2e/desktop.spec.ts`.

**Mockups:** `ACDesktop.dc.html`, `ACDesktopDark.dc.html`, `ACStatsDesktop.dc.html`.

**Поведение:** от 1024px — `DeskRail`, 5 колонок сетки (от 768 до 1023 — 3–4 колонки и нижняя капсула), панель тайтла — модалка 880px, панели жанров и сортировки — `Popover` у чипа (Esc, клик вне, фокус внутрь); карточка при наведении поднимается на 4px с обводкой акцентом и показывает быстрый статус (C5).

**Acceptance (e2e desktop):** 10 карточек в два ряда по 5; модалка по центру, не шире 880px; `Popover` закрывается по Esc.

---

### Task C12: Офлайн, индикатор синхронизации, PWA

**Files:** Create `app/src/ui/SyncBadge.tsx`, `app/src/ui/OfflineBanner.tsx`; Modify `vite.config.ts`; Test `app/e2e/offline.spec.ts`.

**Поведение:** `SyncBadge` в шапке виден только при `pending > 0` («Не сохранено: N») или ошибке; `OfflineBanner` при `navigator.onLine === false` («Нет сети, правки сохранятся»); оболочка работает офлайн (Workbox precache), постеры из кэша; манифест v2, иконки 192/512, `theme_color` обеих тем через `<meta name="theme-color" media="(prefers-color-scheme: dark)">`.

**Acceptance (e2e):** `context.setOffline(true)` → смена статуса видна, баннер виден, `pending = 1`; `setOffline(false)` → очередь уходит (заглушка получает upsert), баннер пропадает.

---

### Task C13: Визуальные эталоны и доступность

**Files:** Create `app/e2e/visual.spec.ts`, `app/e2e/a11y.spec.ts`; эталоны `app/e2e/visual.spec.ts-snapshots/`.

**Поведение:** скриншоты экранов «Бэклог», «Панель тайтла», «Редактирование», «Жанры», «Добавление», «Итоги», «Профиль», «Вход», «Пустая доска» × светлая/тёмная × 390/1440; допуск `maxDiffPixelRatio: 0.01`. Эталоны сначала сверяются глазами с макетами `mockups/*.dc.html` (отклонения — правятся в коде, а не в эталоне). Доступность: проверка через `@axe-core/playwright` без нарушений уровня serious/critical; Lighthouse CI (`@lhci/cli`) PWA ≥ 90, Accessibility ≥ 90, бюджет JS 250KB gzip.

---

### Task C14: Паритет, переключение v2 в корень, удаление v1

**Files:**
- Modify: `.github/workflows/deploy.yml` (сборка v2 с `BL_BASE=/backlog/` в корень `_site`, v1 больше не копируется), `app/vite.config.ts` (базовый путь по умолчанию `/backlog/`), `app/src/config.ts` (`ASSET_ROOT` = `BASE_URL`)
- Move: `images/icon-192.png`, `images/icon-512.png` остаются; `images/covers/` остаётся в корне и копируется в `_site/images`
- Delete: `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `data.js`, `lib/`, `tests/`, `tools/migrate-catalog.js`
- Create: `supabase/migrations/20260926000001_baseline.sql` — снимок текущей схемы (`supabase db dump --schema public` или вручную из SQL-блоков README v1) для истории
- Modify: `README.md` — переписать под v2: как устроено, как запустить, где спеки, как синхронизация; SQL-блоки удаляются (они в `supabase/migrations/`)
- Kanban: закрыть BL-25; BL-27 остаётся открытым до конца D с чеклистом подпроектов

**Шаги-требования:**
1. Пройти чек-лист паритета спеки 6.12 вместе с владельцем на его телефоне и ПК; каждый пункт — отметка в задаче канбана.
2. Воркер v2 в корне: `registerType: 'autoUpdate'`, `cleanupOutdatedCaches: true`, при активации удалить кэши `backlog-shell-v1` и `backlog-covers-v1` (кэши v1).
3. После деплоя проверить: старый воркер заменён (DevTools), вход работает с `https://ledoksi.github.io/backlog/` (redirect URL корня уже есть), зеркало `bl2:*` на месте.
4. Через неделю без жалоб удалить из Supabase Redirect URLs адрес `/backlog/v2/` и из `vite.config.ts` поддержку `BL_BASE=/backlog/v2/`.

## Self-Review

- Спека 6.1 (вход) — A7 + C10 (выход); 6.2 — C2, C3, C5, C6; 6.3 — C4; 6.4 — C7; 6.5 — C8; 6.6 — C3; 6.7 (до B) — C10; 6.8 (без периода) — C9; 6.11 — C1, C4, C7; 6.12 — C14; 9 — C14; 10 — C1…C13.
- Экран ника, доски, соцчасти — осознанно в B и D.
- Имена сверены с A: `useSession`, `Sheet`, `AppShell`, `Section`, `prefixedStorage`, `resolveCover`, `isCaughtUp`, `setTheme`.
