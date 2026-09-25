# A. Фундамент v2 — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поднять новое приложение `app/` (React + TS) с перенесённой логикой, дизайн-токенами, базовыми компонентами и входом, выкатить его на `/backlog/v2/` рядом с текущей версией, и починить BL-26 в текущей версии.

**Architecture:** `app/` — отдельный Vite-проект в том же репозитории. Чистая логика из `lib/*.js` переносится механически (UMD → ES-модули), затем типизируется; поведение не меняется, старые тесты переезжают в Vitest и проходят. GitHub Actions собирает v1 (статичные файлы как есть) и v2 (`app/dist` → `v2/`) в один сайт и публикует на Pages.

**Tech Stack:** Node 22, Vite 7, React 19, TypeScript 5, Motion 12, Zustand 5, supabase-js 2, @phosphor-icons/react 2, @fontsource/onest, @fontsource/unbounded, Vitest 3 + jsdom + Testing Library, Playwright 1.56.1, vite-plugin-pwa 1.

**Spec:** [`../specs/2026-09-25-redesign-social-design.md`](../specs/2026-09-25-redesign-social-design.md), разделы 3, 4, 5, 9, 10. Дизайн: [`../../design/2026-09-25-redesign/`](../../design/2026-09-25-redesign/). Индекс планов: [`2026-09-25-redesign-social-plan.md`](2026-09-25-redesign-social-plan.md).

## Global Constraints

Действуют все пункты из [индекса](2026-09-25-redesign-social-plan.md#global-constraints). Дополнительно для A:

- Схему Supabase не трогать вообще.
- v1 (`index.html`, `app.js`, `styles.css`, `sw.js`, `lib/`, `data.js`, `tests/`) не менять, кроме задачи A1.
- `@playwright/test` строго `1.56.1`: в облачной среде браузеры этой версии предустановлены в `/opt/pw-browsers`, `playwright install` не запускать.
- Ключи `localStorage` v2 всегда с префиксом `bl2:`.
- Базовый путь v2 — `/backlog/v2/` (переменная `BL_BASE`). Постеры лежат в корне сайта (`/backlog/images/covers/`), путь к ним строится через `resolveCover`.

## Review Focus

1. **Постеры в v2 не должны ломаться из-за другого базового пути**: в базе лежат относительные `images/covers/x.jpg`. Тест: `resolveCover` (A3, шаг 6).
2. **Перенос логики не меняет поведение**: все 227 старых тестов проходят в Vitest без правки ожиданий. Тест: A3, A4 (сверка числа тестов).
3. **v1 и v2 на одном устройстве**: v2 не читает и не пишет ключи v1. Тест: e2e `storage-isolation` (A7).
4. **Экран входа при недоступном Supabase или CDN** не зависает: клиент `null` → экран входа с кнопкой, без бесконечного лоадера. Тест: `AuthGate` (A7).
5. **Сервис-воркер v2 не перехватывает v1**: scope `/backlog/v2/`. Проверка: e2e (A8, шаг 6) и ручная проверка после деплоя.

---

### Task A1: BL-26 — «Что посмотреть?» не предлагает досмотренное до конца вышедшего

**Files:**
- Modify: `lib/storage.js` (после `hasPartsChecklist`, и в объекте экспорта)
- Modify: `app.js:647` (фильтр `pool` в обработчике `randomBtn`)
- Test: `tests/storage.test.js`

**Interfaces:**
- Produces: `BacklogStorage.isCaughtUp(title, checkedIndices): boolean` — у тайтла есть чеклист частей, есть хотя бы одна вышедшая и хотя бы одна невышедшая часть, и все вышедшие отмечены. Используется в C6 и B5 (в порте `derive.ts`).

- [ ] **Step 1: Write the failing test** — добавить в конец `tests/storage.test.js` и дописать `isCaughtUp` в деструктуризацию `require('../lib/storage.js')` в первой строке файла.

```js
test('isCaughtUp: every released part watched and more announced', () => {
  var anime = { id: 'frieren-2023', category: 'anime', status: 'queue', parts: [
    { name: 'Сезон 1', released: true }, { name: 'Сезон 2', released: true }, { name: 'Сезон 3', released: false }
  ] };
  assert.equal(isCaughtUp(anime, [0, 1]), true);
  assert.equal(isCaughtUp(anime, [0]), false);
  assert.equal(isCaughtUp(anime, []), false);
});

test('isCaughtUp: false without pending parts, without released parts, or without a checklist', () => {
  var finished = { id: 'a', category: 'series', parts: [{ name: 'S1', released: true }] };
  var future = { id: 'b', category: 'series', parts: [{ name: 'S1', released: false }] };
  var movie = { id: 'c', category: 'movie', status: 'queue' };
  assert.equal(isCaughtUp(finished, [0]), false);
  assert.equal(isCaughtUp(future, []), false);
  assert.equal(isCaughtUp(movie, []), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/*.test.js`
Expected: FAIL, `isCaughtUp is not a function`.

- [ ] **Step 3: Write minimal implementation** — в `lib/storage.js` сразу после функции `hasPartsChecklist`:

```js
  // Watched everything that is out, but more is announced: by the numbers the
  // title is "in progress", yet there is nothing to watch right now. The random
  // pick has to skip these or it suggests something the owner cannot start.
  function isCaughtUp(title, checkedIndices) {
    if (!hasPartsChecklist(title)) return false;
    var p = partsProgress(title.parts, checkedIndices);
    return p.released > 0 && p.pending > 0 && p.watched === p.released;
  }
```

и в объект `return { … }` в конце файла добавить `isCaughtUp: isCaughtUp,`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/*.test.js`
Expected: PASS, 229 tests.

- [ ] **Step 5: Use it in the random pick** — в `app.js` в обработчике `randomBtn.addEventListener('click', …)` заменить строку с `var pool = …` на:

```js
    var pool = titlesForCategory(state.category).filter(function (t) {
      return t.status !== 'done' && t.status !== 'unreleased' && t.category !== 'game'
        && !BacklogStorage.isCaughtUp(t, BacklogStorage.getCheckedParts(window.localStorage, t.id));
    });
```

- [ ] **Step 6: Verify in the browser** — поднять `python3 -m http.server 8765` в корне, открыть с заглушкой Supabase (как в аудите: подменить `supabase.min.js` через Playwright `context.route`, в `localStorage['backlog-added']` положить тайтлы из `data.js`, у Фрирен отметить сезоны 0 и 1 в `backlog-parts`), на вкладке «Аниме» 30 раз нажать «Что посмотреть?» и убедиться, что Фрирен не открывается ни разу.

- [ ] **Step 7: Commit**

```bash
git add lib/storage.js app.js tests/storage.test.js
git commit -m "fix: random pick skips titles caught up with every released part (BL-26)"
```

---

### Task A2: Каркас `app/`

**Files:**
- Create: `app/package.json`, `app/tsconfig.json`, `app/vite.config.ts`, `app/index.html`, `app/src/main.tsx`, `app/src/App.tsx`, `app/tests/setup.ts`, `app/tests/smoke.test.tsx`, `app/.gitignore`
- Modify: `.gitignore` (корневой)

**Interfaces:**
- Produces: команды `npm run dev | build | test | typecheck | e2e` в `app/`; `import.meta.env.BASE_URL` = `/backlog/v2/` в проде.

- [ ] **Step 1: Create `app/package.json`**

```json
{
  "name": "backlog-v2",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "build:e2e": "tsc -b && vite build --mode e2e",
    "preview": "vite preview --port 4173 --strictPort",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@fontsource/onest": "^5.1.0",
    "@fontsource/unbounded": "^5.1.0",
    "@phosphor-icons/react": "^2.1.7",
    "@supabase/supabase-js": "^2.45.0",
    "motion": "^12.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@playwright/test": "1.56.1",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^5.0.0",
    "jsdom": "^25.0.0",
    "typescript": "^5.6.0",
    "vite": "^7.0.0",
    "vite-plugin-pwa": "^1.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `app/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "allowJs": true,
    "checkJs": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "tests", "e2e", "vite.config.ts", "playwright.config.ts"]
}
```

- [ ] **Step 3: Create `app/vite.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.BL_BASE ?? '/backlog/v2/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      scope: base,
      base,
      manifest: {
        name: 'Бэклог',
        short_name: 'Бэклог',
        description: 'Игры, сериалы, кино и аниме, до которых хочется добраться.',
        lang: 'ru',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#eef0f4',
        theme_color: '#eef0f4',
        icons: [
          { src: '../images/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '../images/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/images/covers/'),
            handler: 'CacheFirst',
            options: { cacheName: 'bl2-covers', expiration: { maxEntries: 500 } }
          }
        ]
      }
    })
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx,js}']
  }
});
```

- [ ] **Step 4: Create `app/index.html`** (inline-скрипт темы стоит до CSS, чтобы не было вспышки не той темы)

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
  <title>Бэклог</title>
  <script>
    try { var t = localStorage.getItem('bl2:theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}
  </script>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 5: Create `app/src/main.tsx` and `app/src/App.tsx`**

```tsx
// app/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

```tsx
// app/src/App.tsx
export function App() {
  return <main>Бэклог</main>;
}
```

- [ ] **Step 6: Create test setup and a smoke test**

```ts
// app/tests/setup.ts
import '@testing-library/jest-dom/vitest';
```

```tsx
// app/tests/smoke.test.tsx
import { render, screen } from '@testing-library/react';
import { App } from '../src/App';

test('app renders', () => {
  render(<App />);
  expect(screen.getByText('Бэклог')).toBeInTheDocument();
});
```

- [ ] **Step 7: Create `app/.gitignore` and extend the root one**

`app/.gitignore`:
```
node_modules
dist
test-results
playwright-report
```

В корневой `.gitignore` добавить строку `app/node_modules`.

- [ ] **Step 8: Install and verify**

Run: `cd app && npm install && npm test && npm run build`
Expected: 1 test PASS; `app/dist/index.html` существует, в нём пути к ассетам начинаются с `/backlog/v2/`.

- [ ] **Step 9: Commit**

```bash
git add .gitignore app/package.json app/package-lock.json app/tsconfig.json app/vite.config.ts app/index.html app/src app/tests app/.gitignore
git commit -m "chore: scaffold v2 app (Vite + React + TypeScript)"
```

---

### Task A3: Перенос чистой логики: slug, query, storage, validate + обложки и изоляция хранилища

**Files:**
- Create: `app/src/lib/slug.ts`, `app/src/lib/query.ts`, `app/src/lib/storage.ts`, `app/src/lib/validate.ts`, `app/src/lib/types.ts`, `app/src/lib/covers.ts`, `app/src/lib/prefixedStorage.ts`
- Create: `app/tests/lib/slug.test.ts`, `query.test.ts`, `storage.test.ts`, `validate.test.ts`, `covers.test.ts`, `prefixedStorage.test.ts`
- Не трогать: `lib/*.js`, `tests/*.test.js` (они живут до конца C)

**Interfaces:**
- Consumes: `lib/*.js` как источник кода, `tests/*.test.js` как источник тестов.
- Produces:
  - `types.ts`: `Category`, `Status`, `AiringStatus`, `Part`, `Title`, `StorageLike`.
  - `slug.ts`: `slugify`, `makeId`, `uniqueId` — те же, что в `lib/slug.js`.
  - `query.ts`: `isStillAiring`, `matchesFilters`, `matchesSearch`, `sortTitles`, `countProgress`, `pickRandom`.
  - `storage.ts`: все экспорты `lib/storage.js`, включая `isCaughtUp` из A1.
  - `validate.ts`: `validateTitle`.
  - `covers.ts`: `resolveCover(cover: string | undefined, assetRoot: string): string`.
  - `prefixedStorage.ts`: `prefixedStorage(storage: StorageLike, prefix: string): StorageLike`.

- [ ] **Step 1: Create `app/src/lib/types.ts`**

```ts
export type Category = 'game' | 'series' | 'movie' | 'anime';
export type Status = 'queue' | 'in_progress' | 'done' | 'unreleased';
export type AiringStatus = 'ongoing' | 'completed' | null;

export interface Part {
  name: string;
  year?: number | null;
  released?: boolean;
}

export interface Title {
  id: string;
  title: string;
  category: Category;
  status: Status;
  airingStatus?: AiringStatus;
  year?: number | null;
  genres: string[];
  rating?: number | null;
  synopsis?: string;
  cover?: string;
  originalTitle?: string;
  seasonInfo?: string;
  platforms?: string[];
  parts?: Part[];
  draft?: boolean;
  source?: string | null;
  sourceId?: string | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}
```

- [ ] **Step 2: Port each module with one mechanical recipe.** Для `slug`, `query`, `storage`, `validate`:
  1. Скопировать `lib/<name>.js` в `app/src/lib/<name>.ts`.
  2. Удалить обёртку UMD: первые строки до `function () {` включительно и последние `}));` вместе с `return { … };`.
  3. Всё содержимое тела оставить без изменений логики. `var` можно оставить.
  4. В конце написать `export { a, b, … };` с тем же набором имён, что был в `return { … }`.
  5. Добавить типы только на экспортируемые функции (`title: Title`, `storage: StorageLike`, возвращаемые значения). Внутренности без типов допускаются через `// eslint-disable`-free `any` там, где TS не выводит тип.
  6. Удалить комментарии, которые ссылаются на номера задач (`Task 44`, `BL-18`); комментарии «почему» оставить.

Пример результата для `slug.ts` (тело — копия `lib/slug.js`):

```ts
export function slugify(input: string): string { /* body copied verbatim from lib/slug.js */ }
```

(Выше — форма, не заглушка: тело берётся из исходника буквально.)

- [ ] **Step 3: Port the tests with one recipe.** Для каждого из `tests/{slug,query,storage,validate}.test.js`:
  1. Скопировать в `app/tests/lib/<name>.test.ts`.
  2. `const test = require('node:test');` → удалить (Vitest `test` глобален).
  3. `const assert = require('node:assert/strict');` → `import assert from 'node:assert/strict';`
  4. `const { … } = require('../lib/<name>.js');` → `import { … } from '../../src/lib/<name>';`
  5. Ожидания не менять.

- [ ] **Step 4: Run the ported tests**

Run: `cd app && npx vitest run tests/lib`
Expected: PASS; число тестов = 10 (slug) + 23 (query) + 51 (storage, с двумя из A1) + 10 (validate) = 94.

- [ ] **Step 5: Write failing tests for `covers.ts` and `prefixedStorage.ts`**

```ts
// app/tests/lib/covers.test.ts
import { resolveCover } from '../../src/lib/covers';

test('relative repo paths resolve against the asset root, not the app base', () => {
  expect(resolveCover('images/covers/frieren-2023.jpg', '/backlog/')).toBe('/backlog/images/covers/frieren-2023.jpg');
});
test('absolute and data URLs pass through', () => {
  expect(resolveCover('https://image.tmdb.org/t/p/w500/x.jpg', '/backlog/')).toBe('https://image.tmdb.org/t/p/w500/x.jpg');
  expect(resolveCover('data:image/jpeg;base64,AAA', '/backlog/')).toBe('data:image/jpeg;base64,AAA');
});
test('missing cover falls back to the placeholder', () => {
  expect(resolveCover(undefined, '/backlog/')).toBe('/backlog/images/covers/_placeholder.svg');
  expect(resolveCover('', '/backlog/')).toBe('/backlog/images/covers/_placeholder.svg');
});
```

```ts
// app/tests/lib/prefixedStorage.test.ts
import { prefixedStorage } from '../../src/lib/prefixedStorage';

function memory() {
  const data: Record<string, string> = {};
  return { data, getItem: (k: string) => (k in data ? data[k]! : null), setItem: (k: string, v: string) => { data[k] = v; }, removeItem: (k: string) => { delete data[k]; } };
}

test('keys are namespaced and never touch unprefixed keys', () => {
  const raw = memory();
  raw.setItem('backlog-added', '[1]');
  const s = prefixedStorage(raw, 'bl2:');
  expect(s.getItem('backlog-added')).toBeNull();
  s.setItem('backlog-added', '[2]');
  expect(raw.data['bl2:backlog-added']).toBe('[2]');
  expect(raw.data['backlog-added']).toBe('[1]');
  s.removeItem!('backlog-added');
  expect(raw.data['bl2:backlog-added']).toBeUndefined();
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd app && npx vitest run tests/lib/covers.test.ts tests/lib/prefixedStorage.test.ts`
Expected: FAIL, модули не найдены.

- [ ] **Step 7: Implement**

```ts
// app/src/lib/covers.ts
const PLACEHOLDER = 'images/covers/_placeholder.svg';

// Covers are stored as repo-relative paths ("images/covers/x.jpg") or full
// URLs. v2 is served from a sub-path, so a relative cover must resolve
// against the site root that holds images/, not against the app base.
export function resolveCover(cover: string | undefined, assetRoot: string): string {
  const value = cover && cover.trim() ? cover.trim() : PLACEHOLDER;
  if (/^(https?:|data:|blob:)/.test(value) || value.startsWith('/')) return value;
  return assetRoot.replace(/\/?$/, '/') + value;
}
```

```ts
// app/src/lib/prefixedStorage.ts
import type { StorageLike } from './types';

// v1 and v2 share one origin during the transition; v2 must never read or
// overwrite v1's mirror, so every v2 key lives under its own prefix.
export function prefixedStorage(storage: StorageLike, prefix: string): StorageLike {
  return {
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem?.(prefix + key)
  };
}
```

- [ ] **Step 8: Run all lib tests**

Run: `cd app && npx vitest run tests/lib && npm run typecheck`
Expected: PASS (94 + 4); ошибок типов нет.

- [ ] **Step 9: Commit**

```bash
git add app/src/lib app/tests/lib
git commit -m "feat(v2): port slug/query/storage/validate to TypeScript with their tests"
```

---

### Task A4: Перенос enrich, auth, sync

**Files:**
- Create: `app/src/lib/enrich.ts`, `app/src/lib/auth.ts`, `app/src/lib/sync.ts`
- Create: `app/tests/lib/enrich.test.ts`, `auth.test.ts`, `sync.test.ts`
- Create: `app/src/config.ts` (значения из `app.js:2409-2430`)

**Interfaces:**
- Consumes: `lib/enrich.js`, `lib/auth.js`, `lib/sync.js`; `types.ts`.
- Produces:
  - `enrich.ts`: `searchTmdb`, `fetchTmdbDetails`, `searchRawg`, `fetchRawgDetails`, `searchShikimori`, `fetchShikimoriDetails`, `searchSteam`, `fetchSteamDetails` (сигнатуры как в JS: первый аргумент `fetchFn`).
  - `auth.ts`: `signInWithGoogle`, `signOut`, `getSession`, `onAuthStateChange`, `hasProfile`, `listWorkspaceMembers`, `inviteEmail`, `leaveWorkspace`, `removeMember`.
  - `sync.ts`: `KEYS`, `TABLES`, `createClient`, `pullState`, `applyState`, `pushOverride`, `pushDraft`, `pushRemoveDraft`, `pushParts`, `seedLocal`, `useOutbox`, `outboxLength`, `flushOutbox`, `subscribe`, `consumeEcho`, `_resetEchoes`.
  - `config.ts`: `SUPABASE_URL`, `SUPABASE_KEY`, `TMDB_KEY`, `RAWG_KEY`, `CORS_PROXY`, `ASSET_ROOT`.

- [ ] **Step 1: Port the three modules and their tests** тем же рецептом, что в A3, шаги 2–3. В `sync.ts` параметр `storage` у всех функций остаётся явным: v2 будет передавать `prefixedStorage(localStorage, 'bl2:')`.

- [ ] **Step 2: Run the ported tests**

Run: `cd app && npx vitest run tests/lib`
Expected: PASS; прибавилось 33 (enrich) + 19 (auth) + 83 (sync) = 135, всего 233 в `tests/lib`. Число должно совпасть с числом тестов v1 плюс 2 из A1 и 4 из A3. Если меньше, найти пропущенный тест и перенести.

- [ ] **Step 3: Create `app/src/config.ts`** — значения взять из `app.js` (строки рядом с `var SUPABASE_URL`, `var TMDB_KEY`, `var RAWG_KEY`, `var CORS_PROXY`), это публичные клиентские ключи (README v1, раздел «Ключ намеренно лежит в исходниках»):

```ts
export const SUPABASE_URL = 'https://rjdnpwamcxvhryiigbvt.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_omYttbkLjxA-DDxQAXU9Mw_AguNLqto';
export const TMDB_KEY = '9affbfce7554a8309e8ea9933431b1ff';
export const RAWG_KEY = 'bde5b0fbbc9242d0b0aeec940d845ac3';
export const CORS_PROXY = 'https://backlog-proxy.shmar-shmar2.workers.dev/';
// Covers live in the repo's images/ at the site root, not under the v2 base.
export const ASSET_ROOT = import.meta.env.VITE_ASSET_ROOT ?? '/backlog/';
```

(Значения те же, что в `app.js`: это публичные ключи, которые браузер обязан предъявить сам.)

- [ ] **Step 4: Typecheck and commit**

Run: `cd app && npm run typecheck && npm test`
Expected: PASS.

```bash
git add app/src/lib app/src/config.ts app/tests/lib
git commit -m "feat(v2): port enrich/auth/sync to TypeScript with their tests"
```

---

### Task A5: Токены, шрифты, глобальные стили, тема

**Files:**
- Create: `app/src/design/tokens.css` (копия `docs/design/2026-09-25-redesign/tokens.css` без строки `@import url('https://fonts.googleapis.com…')`)
- Create: `app/src/design/global.css`, `app/src/design/theme.ts`
- Modify: `app/src/main.tsx`
- Test: `app/tests/design/theme.test.ts`

**Interfaces:**
- Produces: `type ThemePref = 'system' | 'light' | 'dark'`; `readTheme(): ThemePref`; `setTheme(pref: ThemePref): void`; `applyTheme(pref: ThemePref, root?: HTMLElement): void`. Ключ `bl2:theme`.

- [ ] **Step 1: Write the failing test**

```ts
// app/tests/design/theme.test.ts
import { readTheme, setTheme, applyTheme } from '../../src/design/theme';

beforeEach(() => { localStorage.clear(); document.documentElement.removeAttribute('data-theme'); });

test('defaults to system and leaves the attribute off', () => {
  expect(readTheme()).toBe('system');
  applyTheme('system');
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
});
test('manual choice is stored and applied', () => {
  setTheme('dark');
  expect(localStorage.getItem('bl2:theme')).toBe('dark');
  expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  setTheme('system');
  expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
});
test('garbage in storage reads as system', () => {
  localStorage.setItem('bl2:theme', 'purple');
  expect(readTheme()).toBe('system');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd app && npx vitest run tests/design`
Expected: FAIL, модуль не найден.

- [ ] **Step 3: Implement `theme.ts`**

```ts
export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'bl2:theme';

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement): void {
  if (pref === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', pref);
}

export function setTheme(pref: ThemePref): void {
  try { localStorage.setItem(KEY, pref); } catch { /* private mode: theme just won't persist */ }
  applyTheme(pref);
}
```

- [ ] **Step 4: Create `global.css`**

```css
@import '@fontsource/onest/400.css';
@import '@fontsource/onest/500.css';
@import '@fontsource/onest/600.css';
@import '@fontsource/onest/700.css';
@import '@fontsource/unbounded/600.css';
@import './tokens.css';

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-body);
  font-size: var(--fs-md);
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}
button, input, textarea, select { font: inherit; color: inherit; }
button { cursor: pointer; white-space: nowrap; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
img { display: block; max-width: 100%; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
```

- [ ] **Step 5: Wire it in `main.tsx`** — первой строкой `import './design/global.css';`.

- [ ] **Step 6: Run tests and build, commit**

Run: `cd app && npm test && npm run build`
Expected: PASS; в `dist/assets` есть woff2 Onest и Unbounded.

```bash
git add app/src/design app/src/main.tsx app/tests/design
git commit -m "feat(v2): design tokens, self-hosted fonts, theme preference"
```

---

### Task A6: Базовые компоненты

**Files:**
- Create: `app/src/ui/Button.tsx`, `Chip.tsx`, `Segmented.tsx`, `Switch.tsx`, `Avatar.tsx`, `StatusPill.tsx`, `Skeleton.tsx`, `EmptyState.tsx` и по `*.module.css` на каждый
- Create: `app/tests/ui/Segmented.test.tsx`, `Switch.test.tsx`, `Avatar.test.tsx`

**Interfaces:**
- Produces (все экспортируются по имени):
  - `Button({ variant: 'primary' | 'tonal' | 'neutral' | 'danger' | 'inverse', size?: 'md' | 'lg', icon?: ReactNode, children, ...buttonProps })`
  - `Chip({ selected?: boolean, count?: number, icon?: ReactNode, children, ...buttonProps })` — `aria-pressed={selected}`
  - `Segmented<T extends string>({ label: string, options: { value: T; label: string }[], value: T, onChange: (v: T) => void, tone?: 'accent' | 'inverse' })` — `role="radiogroup"`, стрелки влево/вправо переключают
  - `Switch({ checked, onChange, label, hint? })` — `role="switch"`
  - `Avatar({ userId: string, name: string, size?: number })` — цвет из `--avatar-1..6` по хэшу `userId`
  - `StatusPill({ status: Status, onPoster?: boolean })`
  - `Skeleton({ kind: 'card' | 'row' })`
  - `EmptyState({ title, text, action? })`

Размеры, отступы и цвета каждого компонента берутся из листа `docs/design/2026-09-25-redesign/mockups/Main.dc.html` и таблицы компонентов в `design-system.md` §5.

- [ ] **Step 1: Write failing tests**

```tsx
// app/tests/ui/Segmented.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Segmented } from '../../src/ui/Segmented';

function Harness() {
  const [v, setV] = useState<'a' | 'b' | 'c'>('a');
  return <Segmented label="Статус" value={v} onChange={setV} options={[{ value: 'a', label: 'В бэклоге' }, { value: 'b', label: 'Смотрю' }, { value: 'c', label: 'Завершено' }]} />;
}

test('click selects and exposes radio semantics', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('radio', { name: 'Смотрю' }));
  expect(screen.getByRole('radio', { name: 'Смотрю' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'В бэклоге' })).toHaveAttribute('aria-checked', 'false');
});

test('arrow keys move the selection', async () => {
  render(<Harness />);
  screen.getByRole('radio', { name: 'В бэклоге' }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: 'Смотрю' })).toHaveAttribute('aria-checked', 'true');
  await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
  expect(screen.getByRole('radio', { name: 'Завершено' })).toHaveAttribute('aria-checked', 'true');
});
```

```tsx
// app/tests/ui/Switch.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from '../../src/ui/Switch';

test('toggles through onChange with switch semantics', async () => {
  const onChange = vi.fn();
  render(<Switch checked={false} onChange={onChange} label="Лидерборд" />);
  const sw = screen.getByRole('switch', { name: 'Лидерборд' });
  expect(sw).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(sw);
  expect(onChange).toHaveBeenCalledWith(true);
});
```

```tsx
// app/tests/ui/Avatar.test.tsx
import { avatarSlot } from '../../src/ui/Avatar';

test('same user always gets the same color slot, within 1..6', () => {
  const a = avatarSlot('4f7c2b9e-0000-0000-0000-000000000001');
  expect(a).toBe(avatarSlot('4f7c2b9e-0000-0000-0000-000000000001'));
  expect(a).toBeGreaterThanOrEqual(1);
  expect(a).toBeLessThanOrEqual(6);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run tests/ui`
Expected: FAIL, модули не найдены.

- [ ] **Step 3: Implement `Segmented`, `Switch`, `Avatar`**

```tsx
// app/src/ui/Segmented.tsx
import { useRef, type KeyboardEvent } from 'react';
import s from './Segmented.module.css';

interface Props<T extends string> {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  tone?: 'accent' | 'inverse';
}

export function Segmented<T extends string>({ label, options, value, onChange, tone = 'accent' }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = options.findIndex((o) => o.value === value);

  function onKey(e: KeyboardEvent) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = (index + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className={s.group} onKeyDown={onKey}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={o.value === value ? `${s.item} ${s[tone]}` : s.item}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

```css
/* app/src/ui/Segmented.module.css */
.group { display: flex; gap: 4px; padding: 5px; border-radius: var(--r-pill); background: var(--surface); box-shadow: var(--shadow-soft); }
.item { flex: 1; min-height: 40px; padding: 0 16px; border: 0; border-radius: var(--r-pill); background: transparent; color: var(--muted); font-size: var(--fs-md); font-weight: 600; transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out); }
.accent { background: var(--accent); color: var(--on-accent); }
.inverse { background: var(--inverse); color: var(--on-inverse); }
```

```tsx
// app/src/ui/Switch.tsx
import s from './Switch.module.css';

interface Props { checked: boolean; onChange: (next: boolean) => void; label: string; hint?: string }

export function Switch({ checked, onChange, label, hint }: Props) {
  return (
    <div className={s.row}>
      <div className={s.text}>
        <span className={s.label}>{label}</span>
        {hint && <span className={s.hint}>{hint}</span>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-label={label}
        className={checked ? `${s.track} ${s.on}` : s.track} onClick={() => onChange(!checked)}>
        <span className={s.thumb} />
      </button>
    </div>
  );
}
```

```css
/* app/src/ui/Switch.module.css */
.row { min-height: 64px; padding: 10px 16px; display: flex; align-items: center; gap: 12px; }
.text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.label { font-size: var(--fs-md); font-weight: 600; }
.hint { font-size: var(--fs-xs); color: var(--muted); line-height: 1.35; }
.track { width: 52px; height: 32px; flex-shrink: 0; border: 0; border-radius: 16px; padding: 3px; display: flex; justify-content: flex-start; background: var(--dash); transition: background var(--dur-fast); }
.on { background: var(--accent); justify-content: flex-end; }
.thumb { width: 26px; height: 26px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.25); }
```

```tsx
// app/src/ui/Avatar.tsx
import s from './Avatar.module.css';

export function avatarSlot(userId: string): number {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return (h % 6) + 1;
}

export function Avatar({ userId, name, size = 40 }: { userId: string; name: string; size?: number }) {
  const letter = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <span className={s.avatar} aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: `var(--avatar-${avatarSlot(userId)})` }}>
      {letter}
    </span>
  );
}
```

```css
/* app/src/ui/Avatar.module.css */
.avatar { border-radius: 50%; color: var(--avatar-ink); font-weight: 700; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
```

- [ ] **Step 4: Implement `Button`, `Chip`, `StatusPill`, `Skeleton`, `EmptyState`**

```tsx
// app/src/ui/Button.tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import s from './Button.module.css';

type Variant = 'primary' | 'tonal' | 'neutral' | 'danger' | 'inverse';
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: 'md' | 'lg'; icon?: ReactNode }

export function Button({ variant = 'primary', size = 'md', icon, children, className, ...rest }: Props) {
  return (
    <button type="button" {...rest} className={[s.btn, s[variant], s[size], className].filter(Boolean).join(' ')}>
      {icon}{children}
    </button>
  );
}
```

```css
/* app/src/ui/Button.module.css */
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: var(--r-md); font-weight: 600; font-size: var(--fs-md); padding: 0 22px; transition: transform var(--dur-fast) var(--ease-out); }
.btn:active { transform: scale(0.97); }
.md { min-height: var(--btn-h); }
.lg { min-height: var(--btn-h-lg); border-radius: 22px; font-size: 16px; }
.primary { background: var(--accent); color: var(--on-accent); }
.tonal { background: var(--accent-soft); color: var(--accent-text); }
.neutral { background: var(--sunken); color: var(--text); }
.danger { background: var(--danger-soft); color: var(--danger); }
.inverse { background: var(--inverse); color: var(--on-inverse); }
```

```tsx
// app/src/ui/Chip.tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import s from './Chip.module.css';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { selected?: boolean; count?: number; icon?: ReactNode; tone?: 'plain' | 'accent' }

export function Chip({ selected = false, count, icon, tone = 'plain', children, ...rest }: Props) {
  return (
    <button type="button" aria-pressed={selected} {...rest}
      className={[s.chip, tone === 'accent' ? s.accent : '', selected ? s.selected : ''].join(' ')}>
      {icon}{children}{count != null && <span className={s.count}>{count}</span>}
    </button>
  );
}
```

```css
/* app/src/ui/Chip.module.css */
.chip { min-height: 38px; padding: 0 14px; border: 0; border-radius: var(--r-pill); background: var(--surface); color: var(--text-2); font-size: var(--fs-base); font-weight: 500; display: inline-flex; align-items: center; gap: 7px; flex-shrink: 0; }
.accent { background: var(--accent-soft); color: var(--accent-text); font-weight: 600; }
.selected { background: var(--accent); color: var(--on-accent); }
.count { font-size: var(--fs-xs); opacity: .6; }
```

```tsx
// app/src/ui/StatusPill.tsx
import type { Status } from '../lib/types';
import s from './StatusPill.module.css';

const LABEL: Record<Status, string> = { queue: 'В бэклоге', in_progress: 'Смотрю', done: 'Завершено', unreleased: 'Ещё не вышло' };
const VAR: Record<Status, string> = { queue: 'queue', in_progress: 'progress', done: 'done', unreleased: 'unreleased' };

export function StatusPill({ status, onPoster = false }: { status: Status; onPoster?: boolean }) {
  const v = VAR[status];
  return (
    <span className={onPoster ? `${s.pill} ${s.onPoster}` : s.pill}
      style={{ color: `var(--st-${v})`, background: onPoster ? undefined : `var(--st-${v}-soft, transparent)` }}>
      <span className={s.dot} style={{ background: `var(--st-${v})` }} />{LABEL[status]}
    </span>
  );
}
```

```css
/* app/src/ui/StatusPill.module.css */
.pill { height: 28px; padding: 0 11px 0 9px; border-radius: var(--r-pill); display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-xs); font-weight: 600; white-space: nowrap; }
.onPoster { background: var(--chip-on-poster); backdrop-filter: blur(12px); }
.dot { width: 7px; height: 7px; border-radius: 50%; }
```

```tsx
// app/src/ui/Skeleton.tsx
import s from './Skeleton.module.css';

export function Skeleton({ kind }: { kind: 'card' | 'row' }) {
  if (kind === 'row') return <div className={`${s.shimmer} ${s.row}`} aria-hidden="true" />;
  return (
    <div className={s.card} aria-hidden="true">
      <div className={`${s.shimmer} ${s.poster}`} />
      <div className={`${s.shimmer} ${s.line}`} />
      <div className={`${s.shimmer} ${s.lineShort}`} />
    </div>
  );
}
```

```css
/* app/src/ui/Skeleton.module.css */
.card { display: flex; flex-direction: column; gap: 9px; }
.poster { aspect-ratio: 2 / 3; border-radius: var(--r-poster); }
.line { height: 14px; border-radius: 7px; width: 90%; }
.lineShort { height: 12px; border-radius: 6px; width: 55%; }
.row { height: 64px; border-radius: 22px; }
.shimmer { background: linear-gradient(100deg, var(--poster-empty) 30%, var(--surface) 50%, var(--poster-empty) 70%); background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
@keyframes shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .shimmer { animation: none; } }
```

```tsx
// app/src/ui/EmptyState.tsx
import type { ReactNode } from 'react';
import s from './EmptyState.module.css';

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className={s.wrap}>
      <div className={s.stack} aria-hidden="true"><span /><span /><span className={s.front}>+</span></div>
      <h2 className={s.title}>{title}</h2>
      <p className={s.text}>{text}</p>
      {action}
    </div>
  );
}
```

```css
/* app/src/ui/EmptyState.module.css */
.wrap { display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center; padding: 40px 24px; }
.stack { position: relative; width: 220px; height: 190px; }
.stack span { position: absolute; top: 20px; width: 104px; height: 156px; border-radius: var(--r-poster); background: var(--poster-empty); }
.stack span:nth-child(1) { left: 20px; transform: rotate(-10deg); }
.stack span:nth-child(2) { right: 20px; transform: rotate(10deg); }
.front { left: 58px; top: 6px !important; background: var(--surface) !important; border: 2px dashed var(--dash); color: var(--accent-text); font-size: 34px; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-soft); }
.title { margin: 0; font-family: var(--font-display); font-size: 20px; font-weight: 600; }
.text { margin: 0; color: var(--text-2); line-height: 1.45; max-width: 32ch; }
```

- [ ] **Step 5: Run tests**

Run: `cd app && npx vitest run tests/ui && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/ui app/tests/ui
git commit -m "feat(v2): base UI components from the A+C design system"
```

---

### Task A7: Панель снизу, оболочка навигации, Supabase-клиент и вход

**Files:**
- Create: `app/src/ui/Sheet.tsx` + `Sheet.module.css`
- Create: `app/src/ui/TabBar.tsx`, `app/src/ui/DeskRail.tsx`, `app/src/ui/AppShell.tsx` + `*.module.css`
- Create: `app/src/data/supabase.ts`, `app/src/data/session.ts`
- Create: `app/src/screens/SignIn.tsx`, `app/src/screens/NotInvited.tsx` + css
- Modify: `app/src/App.tsx`
- Create: `app/tests/ui/Sheet.test.tsx`, `app/tests/data/session.test.ts`
- Create: `app/playwright.config.ts`, `app/e2e/fixtures/supabaseStub.ts`, `app/e2e/auth.spec.ts`, `app/e2e/storage-isolation.spec.ts`

**Interfaces:**
- Consumes: `lib/auth.ts` (A4), `config.ts` (A4), `ui/*` (A6), `design/theme.ts` (A5).
- Produces:
  - `Sheet({ open, onClose, labelledBy, children, footer? })` — портал; ловушка фокуса; Esc; клик по затемнению; свайп вниз > 120px закрывает; при открытии добавляет запись `history.pushState({ sheet: true })`, «Назад» закрывает; возвращает фокус на вызвавший элемент.
  - `TabBar({ active: Section, badge?: number, onNavigate, onAdd, sections })`, `DeskRail({ … то же })`, `type Section = 'backlog' | 'friends' | 'stats' | 'profile'`.
  - `AppShell({ section, onNavigate, onAdd, children })` — телефон: контент + `TabBar`; от 1024px: `DeskRail` слева.
  - `getSupabase(): SupabaseClient | null` — `null`, если не удалось создать; в сборке `--mode e2e` берёт `window.__blSupabaseStub`, если он есть.
  - `useSession(): { state: 'loading' | 'signedOut' | 'blocked' | 'ready'; userId: string | null; signIn(): void; signOut(): void }`.

- [ ] **Step 1: Failing tests for Sheet and session**

```tsx
// app/tests/ui/Sheet.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Sheet } from '../../src/ui/Sheet';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Открыть</button>
      <Sheet open={open} onClose={() => setOpen(false)} labelledBy="t">
        <h2 id="t">Жанры</h2>
        <button>Первая</button>
      </Sheet>
    </>
  );
}

test('opens as a labelled modal dialog and closes on Escape, returning focus', async () => {
  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'Открыть' });
  await userEvent.click(opener);
  expect(screen.getByRole('dialog', { name: 'Жанры' })).toHaveAttribute('aria-modal', 'true');
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});

test('Tab stays inside the sheet', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Открыть' }));
  await userEvent.tab();
  await userEvent.tab();
  await userEvent.tab();
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
});
```

```ts
// app/tests/data/session.test.ts
import { resolveSessionState } from '../../src/data/session';

test('no client means signed out, never an endless loader', () => {
  expect(resolveSessionState({ hasClient: false, userId: null, hasProfile: false })).toBe('signedOut');
});
test('signed in without a profile is blocked, with a profile is ready', () => {
  expect(resolveSessionState({ hasClient: true, userId: 'u', hasProfile: false })).toBe('blocked');
  expect(resolveSessionState({ hasClient: true, userId: 'u', hasProfile: true })).toBe('ready');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd app && npx vitest run tests/ui/Sheet.test.tsx tests/data`
Expected: FAIL, модули не найдены.

- [ ] **Step 3: Implement `Sheet`**

```tsx
// app/src/ui/Sheet.tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import s from './Sheet.module.css';

interface Props { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode; footer?: ReactNode }

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea, select, [tabindex]:not([tabindex="-1"])';

export function Sheet({ open, onClose, labelledBy, children, footer }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    document.body.style.overflow = 'hidden';
    history.pushState({ sheet: true }, '');
    const onPop = () => onClose();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.body.style.overflow = '';
      if (history.state && history.state.sheet) history.back();
      opener.current?.focus();
    };
  }, [open, onClose]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0]!, last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={s.root} onKeyDown={onKeyDown}>
          <motion.div className={s.scrim} onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.2 }} />
          <motion.div ref={panel} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} className={s.panel}
            initial={reduce ? false : { y: '100%' }} animate={{ y: 0 }} exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            drag={reduce ? false : 'y'} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => { if (info.offset.y > 120) onClose(); }}>
            <div className={s.handle} aria-hidden="true" />
            <div className={s.body}>{children}</div>
            {footer && <div className={s.footer}>{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
```

```css
/* app/src/ui/Sheet.module.css */
.root { position: fixed; inset: 0; z-index: 50; }
.scrim { position: absolute; inset: 0; background: var(--scrim); }
.panel { position: absolute; left: 0; right: 0; bottom: 0; max-height: calc(100dvh - 40px); display: flex; flex-direction: column; background: var(--surface); border-radius: var(--r-sheet) var(--r-sheet) 0 0; padding: 10px 20px 0; outline: none; }
.handle { width: 44px; height: 5px; border-radius: 3px; background: var(--dash); align-self: center; margin-bottom: 12px; flex-shrink: 0; }
.body { overflow-y: auto; overscroll-behavior: contain; padding-bottom: 16px; }
.footer { flex-shrink: 0; display: flex; gap: 8px; padding: 14px 0 max(28px, env(safe-area-inset-bottom)); border-top: 1px solid var(--line); }
@media (min-width: 1024px) {
  .panel { left: 50%; right: auto; bottom: auto; top: 50%; width: min(880px, calc(100vw - 64px)); transform: translate(-50%, -50%); border-radius: var(--r-sheet); max-height: calc(100dvh - 64px); }
  .handle { display: none; }
}
```

- [ ] **Step 4: Implement session state and the Supabase client**

```ts
// app/src/data/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_KEY, SUPABASE_URL } from '../config';

declare global { interface Window { __blSupabaseStub?: { createClient(): SupabaseClient } } }

let client: SupabaseClient | null | undefined;

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  try {
    if (import.meta.env.MODE === 'e2e' && window.__blSupabaseStub) client = window.__blSupabaseStub.createClient();
    else client = createClient(SUPABASE_URL, SUPABASE_KEY);
  } catch {
    client = null;
  }
  return client;
}
```

```ts
// app/src/data/session.ts
import { useCallback, useEffect, useState } from 'react';
import { getSupabase } from './supabase';
import * as Auth from '../lib/auth';

export type SessionState = 'loading' | 'signedOut' | 'blocked' | 'ready';

export function resolveSessionState(x: { hasClient: boolean; userId: string | null; hasProfile: boolean }): Exclude<SessionState, 'loading'> {
  if (!x.hasClient || !x.userId) return 'signedOut';
  return x.hasProfile ? 'ready' : 'blocked';
}

export function useSession() {
  const [state, setState] = useState<SessionState>('loading');
  const [userId, setUserId] = useState<string | null>(null);

  const evaluate = useCallback(async () => {
    const sb = getSupabase();
    if (!sb) { setState('signedOut'); return; }
    const res = await Auth.getSession(sb);
    const id = res?.data?.session?.user?.id ?? null;
    setUserId(id);
    const ok = id ? await Auth.hasProfile(sb, id) : false;
    setState(resolveSessionState({ hasClient: true, userId: id, hasProfile: ok }));
  }, []);

  useEffect(() => {
    void evaluate();
    const sub = Auth.onAuthStateChange(getSupabase(), () => { void evaluate(); });
    return () => sub.unsubscribe();
  }, [evaluate]);

  return {
    state,
    userId,
    signIn: () => { void Auth.signInWithGoogle(getSupabase(), window.location.origin + import.meta.env.BASE_URL); },
    signOut: () => { void Auth.signOut(getSupabase()).then(evaluate); }
  };
}
```

- [ ] **Step 5: Implement `TabBar`, `DeskRail`, `AppShell`** — по макетам `TabBar.dc.html` (капсула 358×68 + «+» 68×68, стекло `--glass`, `backdrop-filter: blur(22px) saturate(160%)`, отступ снизу `max(26px, env(safe-area-inset-bottom))`) и `DeskRail.dc.html` (96px). Иконки Phosphor: `SquaresFour` (Бэклог), `UsersThree` (Друзья), `ChartBar` (Итоги), `UserCircle` (Профиль), `Plus` (добавить), `Moon`/`Sun` (тема). Секции передаются списком, чтобы до подпроекта D «Друзья» можно было не показывать.

```tsx
// app/src/ui/TabBar.tsx
import { ChartBar, Plus, SquaresFour, UserCircle, UsersThree } from '@phosphor-icons/react';
import s from './TabBar.module.css';

export type Section = 'backlog' | 'friends' | 'stats' | 'profile';
export const SECTION_LABEL: Record<Section, string> = { backlog: 'Бэклог', friends: 'Друзья', stats: 'Итоги', profile: 'Профиль' };
const ICON = { backlog: SquaresFour, friends: UsersThree, stats: ChartBar, profile: UserCircle };

interface Props { sections: Section[]; active: Section; badge?: number; onNavigate: (s: Section) => void; onAdd: () => void }

export function TabBar({ sections, active, badge = 0, onNavigate, onAdd }: Props) {
  return (
    <div className={s.wrap}>
      <nav aria-label="Разделы" className={s.capsule}>
        {sections.map((key) => {
          const Icon = ICON[key];
          const on = key === active;
          return (
            <button key={key} type="button" aria-current={on ? 'page' : undefined} className={on ? `${s.item} ${s.on}` : s.item} onClick={() => onNavigate(key)}>
              <Icon size={22} weight={on ? 'fill' : 'regular'} aria-hidden="true" />
              {SECTION_LABEL[key]}
              {key === 'friends' && badge > 0 && !on && <span className={s.badge}>{badge}</span>}
            </button>
          );
        })}
      </nav>
      <button type="button" aria-label="Добавить тайтл" className={s.fab} onClick={onAdd}><Plus size={28} weight="bold" /></button>
    </div>
  );
}
```

```css
/* app/src/ui/TabBar.module.css */
.wrap { position: fixed; left: 16px; right: 16px; bottom: max(26px, env(safe-area-inset-bottom)); display: flex; gap: 10px; align-items: center; z-index: 40; }
.capsule { flex: 1; height: var(--tabbar-h); padding: 6px; display: flex; gap: 2px; border-radius: var(--r-pill); background: var(--glass); backdrop-filter: blur(22px) saturate(160%); -webkit-backdrop-filter: blur(22px) saturate(160%); border: 1px solid var(--glass-border); box-shadow: var(--shadow-glass); }
.item { position: relative; flex: 1; border: 0; border-radius: var(--r-pill); background: transparent; color: var(--muted); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; font-size: var(--fs-micro); font-weight: 500; }
.on { background: var(--accent-soft); color: var(--accent-text); font-weight: 700; }
.badge { position: absolute; top: 7px; right: 13px; min-width: 17px; height: 17px; padding: 0 4px; border-radius: 9px; background: var(--badge); color: #fff; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.fab { width: var(--tabbar-h); height: var(--tabbar-h); flex-shrink: 0; border: 0; border-radius: 50%; background: var(--accent); color: var(--on-accent); box-shadow: var(--shadow-fab); display: flex; align-items: center; justify-content: center; }
@media (min-width: 1024px) { .wrap { display: none; } }
```

`DeskRail.tsx` — тот же набор пропсов, вертикальная колонка по `DeskRail.dc.html`; на ширине меньше 1024px `display: none`. `AppShell.tsx`:

```tsx
// app/src/ui/AppShell.tsx
import type { ReactNode } from 'react';
import { TabBar, type Section } from './TabBar';
import { DeskRail } from './DeskRail';
import s from './AppShell.module.css';

interface Props { sections: Section[]; section: Section; badge?: number; onNavigate: (s: Section) => void; onAdd: () => void; children: ReactNode }

export function AppShell({ sections, section, badge, onNavigate, onAdd, children }: Props) {
  return (
    <div className={s.shell}>
      <DeskRail sections={sections} active={section} badge={badge} onNavigate={onNavigate} onAdd={onAdd} />
      <main className={s.main}>{children}</main>
      <TabBar sections={sections} active={section} badge={badge} onNavigate={onNavigate} onAdd={onAdd} />
    </div>
  );
}
```

```css
/* app/src/ui/AppShell.module.css */
.shell { min-height: 100dvh; }
.main { padding: max(54px, env(safe-area-inset-top)) var(--gutter) 130px; }
@media (min-width: 1024px) { .shell { display: flex; } .main { flex: 1; min-width: 0; padding: 28px var(--gutter-desktop) 40px 12px; } }
```

- [ ] **Step 6: Implement `SignIn`, `NotInvited` and wire `App`** — `SignIn` по `ACSignIn.dc.html`: стена постеров (16 файлов `images/covers/*.jpg` из макета через `resolveCover(…, ASSET_ROOT)`), заголовок Unbounded 40, текст, `Button size="lg"` «Войти через Google», подпись «Вход по приглашению». `NotInvited`: заголовок «Этот аккаунт пока не приглашён», `Button variant="neutral"` «Выйти».

```tsx
// app/src/App.tsx
import { useState } from 'react';
import { useSession } from './data/session';
import { SignIn } from './screens/SignIn';
import { NotInvited } from './screens/NotInvited';
import { AppShell } from './ui/AppShell';
import type { Section } from './ui/TabBar';
import { Skeleton } from './ui/Skeleton';

const SECTIONS: Section[] = ['backlog', 'stats', 'profile'];

export function App() {
  const session = useSession();
  const [section, setSection] = useState<Section>('backlog');

  if (session.state === 'loading') return <div style={{ padding: 18 }}><Skeleton kind="card" /></div>;
  if (session.state === 'signedOut') return <SignIn onSignIn={session.signIn} />;
  if (session.state === 'blocked') return <NotInvited onSignOut={session.signOut} />;
  return (
    <AppShell sections={SECTIONS} section={section} onNavigate={setSection} onAdd={() => {}}>
      <h1 style={{ fontFamily: 'var(--font-display)' }}>Бэклог</h1>
    </AppShell>
  );
}
```

Удалить `app/tests/smoke.test.tsx` из A2: «Бэклог» теперь рендерится только после входа, а вход покрыт e2e.

- [ ] **Step 7: Run unit tests**

Run: `cd app && npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 8: e2e harness** — `app/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:4173/backlog/v2/' },
  webServer: { command: 'npm run build:e2e && npm run preview', url: 'http://localhost:4173/backlog/v2/', reuseExistingServer: true, timeout: 180_000 },
  projects: [
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } }
  ]
});
```

`app/e2e/fixtures/supabaseStub.ts` — функция `installStub(page, { signedIn, hasProfile, drafts, overrides, parts })`, которая через `page.addInitScript` кладёт в `window.__blSupabaseStub` объект с методами `auth.getSession`, `auth.onAuthStateChange`, `auth.signInWithOAuth`, `auth.signOut`, `from(table).select/eq/maybeSingle/upsert/delete/in`, `rpc`, `channel().on().subscribe()`, `removeChannel`. Ответы: `profiles` → строка, если `hasProfile`; `drafts/overrides/parts` → переданные массивы. Эталон поведения — заглушка из аудита 2026-09-25 (описана в спеке, раздел 10): те же методы, что вызывает `lib/auth.ts` и `lib/sync.ts`.

```ts
// app/e2e/auth.spec.ts
import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';

test('signed out shows the sign-in screen', async ({ page }) => {
  await installStub(page, { signedIn: false });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Войти через Google' })).toBeVisible();
});

test('signed in without a profile shows not-invited', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: false });
  await page.goto('./');
  await expect(page.getByText('Этот аккаунт пока не приглашён')).toBeVisible();
});

test('signed in with a profile reaches the shell with bottom navigation on phone', async ({ page, isMobile }) => {
  await installStub(page, { signedIn: true, hasProfile: true });
  await page.goto('./');
  const nav = page.getByRole('navigation', { name: 'Разделы' });
  await expect(nav.filter({ visible: true })).toBeVisible();
  if (isMobile) await expect(page.getByRole('button', { name: 'Добавить тайтл' }).first()).toBeVisible();
});
```

```ts
// app/e2e/storage-isolation.spec.ts
import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';

test('v2 never touches v1 localStorage keys', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('backlog-added', '[{"id":"v1-only"}]');
    localStorage.setItem('backlog-overrides', '{"v1-only":{"status":"done"}}');
  });
  await installStub(page, { signedIn: true, hasProfile: true });
  await page.goto('./');
  await page.waitForTimeout(500);
  const keys = await page.evaluate(() => ({ added: localStorage.getItem('backlog-added'), overrides: localStorage.getItem('backlog-overrides') }));
  expect(keys.added).toBe('[{"id":"v1-only"}]');
  expect(keys.overrides).toBe('{"v1-only":{"status":"done"}}');
});
```

- [ ] **Step 9: Run e2e**

Run: `cd app && npm run e2e`
Expected: PASS в проектах `phone` и `desktop`.

- [ ] **Step 10: Commit**

```bash
git add app/src app/tests app/e2e app/playwright.config.ts
git commit -m "feat(v2): bottom sheet, navigation shell, Supabase session and sign-in gate"
```

---

### Task A8: CI и деплой v1 + v2 на GitHub Pages

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`
- Modify: `README.md` (короткий раздел «v2 (в разработке)» в начале: где живёт, как запустить)

**Interfaces:**
- Produces: каждый push в `master` публикует сайт, где корень — v1 (как сейчас), `/v2/` — v2. Каждый PR прогоняет тесты v1, тесты и сборку v2, e2e.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  pull_request:
  push:
    branches-ignore: [master]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: app/package-lock.json }
      - name: v1 tests
        run: node --test tests/*.test.js
      - name: v2 install
        working-directory: app
        run: npm ci
      - name: v2 unit tests and types
        working-directory: app
        run: npm test && npm run typecheck
      - name: v2 e2e
        working-directory: app
        run: npx playwright install --with-deps chromium && npm run e2e
```

(`playwright install` здесь нужен: это раннер GitHub, а не облачная среда Claude с предустановленными браузерами.)

- [ ] **Step 2: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy
on:
  push:
    branches: [master]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: app/package-lock.json }
      - run: node --test tests/*.test.js
      - working-directory: app
        run: npm ci && npm test && npm run build
      - name: Assemble site (v1 at root, v2 under /v2/)
        run: |
          mkdir -p _site
          cp -r index.html app.js styles.css sw.js manifest.webmanifest data.js lib images _site/
          cp -r app/dist _site/v2
      - uses: actions/upload-pages-artifact@v3
        with: { path: _site }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

(`data.js` копируется, потому что `sw.js` v1 держит его в списке предзагрузки: без файла установка воркера v1 падает. Уходит вместе с v1 в конце C.)

- [ ] **Step 3: Owner does two manual settings** (записать в описание PR и сообщить владельцу):
  1. GitHub → репозиторий → Settings → Pages → Source: **GitHub Actions**.
  2. Supabase (проект `rjdnpwamcxvhryiigbvt`) → Authentication → URL Configuration → Redirect URLs: добавить `https://ledoksi.github.io/backlog/v2/`.

- [ ] **Step 4: Add the README note** — в начало `README.md`, после первого абзаца:

```markdown
> **v2 в разработке.** Новый интерфейс живёт в `app/` (React + Vite) и открывается по адресу `/backlog/v2/`. Спека: `docs/superpowers/specs/2026-09-25-redesign-social-design.md`, планы: `docs/superpowers/plans/2026-09-25-redesign-*.md`. Запуск: `cd app && npm install && npm run dev`.
```

- [ ] **Step 5: Commit, PR, merge after CI is green**

```bash
git add .github README.md
git commit -m "ci: test both versions and deploy v1 + v2 to GitHub Pages"
```

- [ ] **Step 6: Verify the deployment** — после мёржа и ручных настроек владельца:
  - `https://ledoksi.github.io/backlog/` — v1 работает как раньше (вход, сетка, синхронизация).
  - `https://ledoksi.github.io/backlog/v2/` — экран входа v2; вход через Google возвращает на `/v2/`, открывается оболочка с навигацией.
  - В DevTools → Application → Service Workers два воркера: scope `/backlog/` (v1) и `/backlog/v2/` (v2).
  - Постеры на экране входа v2 грузятся с `/backlog/images/covers/`.

## Self-Review (выполнено при написании)

- Покрытие спеки для A: раздел 3 (подпроект A и BL-26) — A1…A8; 4.1 (стек) — A2, A5, A6; 4.2 (структура) — A2…A7; 4.3 (параллельная жизнь) — A7 (изоляция ключей), A8 (деплой, scope); 5 (тема, навигация, точки перелома) — A5, A7; 10 (перенос тестов, e2e с заглушкой) — A3, A4, A7.
- Заглушек нет. В A3, шаг 2 тело функций намеренно не повторяется: это механический перенос файла `lib/*.js` без изменений, источник указан точно.
- Имена сверены: `isCaughtUp` (A1) используется в C6; `prefixedStorage`, `resolveCover`, `getSupabase`, `useSession`, `Sheet`, `AppShell`, `Section` используются в плане C с теми же сигнатурами.
