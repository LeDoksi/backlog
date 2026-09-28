# C14: v2 в корень, удаление v1 — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `https://ledoksi.github.io/backlog/` открывает v2; v1 и её тесты удалены из репозитория; кто был на v1 или на `/backlog/v2/`, попадает на новую версию без ручной чистки кэша.

**Architecture:** Сборка v2 с базой `/backlog/` кладётся в корень `_site`, рядом `images/`. Воркер v2 регистрируется по тому же адресу `sw.js`, что и воркер v1, поэтому браузер воспринимает его как обновление той же регистрации; дополнительный скрипт в воркере при активации удаляет кэши v1 и один раз перезагружает вкладки, где ещё крутится v1. По адресу `/backlog/v2/` публикуются страница-переадресация и воркер-«выключатель», который удаляет кэши старой установки v2, снимает свою регистрацию и уводит открытые вкладки в корень.

**Tech Stack:** как в плане C (Vite 7, vite-plugin-pwa/Workbox, GitHub Pages через Actions).

**Spec:** [`../specs/2026-09-25-redesign-social-design.md`](../specs/2026-09-25-redesign-social-design.md) §3 (подпроект C), §6.12; задача C14 в [`2026-09-25-redesign-C-core.md`](2026-09-25-redesign-C-core.md). Разрешение владельца: Georgy, тред проекта 2026-09-28 21:24 («отлично, давай» после проверки v2).

## Global Constraints

- Схема Supabase не меняется. Файл базовой миграции — только история.
- Supabase Redirect URLs: корень `https://ledoksi.github.io/backlog/` уже есть (им пользовалась v1). `/backlog/v2/` остаётся ещё неделю (шаг 4 C14), затем удаляется владельцем.
- Сборка с `BL_BASE=/backlog/v2/` остаётся рабочей неделю (шаг 4 C14).
- `images/`, `worker/` (CORS-прокси) и `supabase/` остаются.

## Review Focus

1. Вкладка v1, открытая во время выкладки: воркер v1 отдаёт оболочку «сначала сеть», значит следующая загрузка уже v2; открытая вкладка перезагружается один раз, когда новый воркер находит кэш `backlog-shell-v1`. Бесконечной перезагрузки быть не должно (кэш удаляется до перезагрузки).
2. Иконка «на экране Домой» от v2 (`start_url` `/backlog/v2/`): открывается, воркер-«выключатель» снимается, пользователь оказывается на `/backlog/`.
3. Имена кэшей общие для всего домена: «выключатель» удаляет только кэши со своим адресом (`/backlog/v2/`), а не `bl2-covers` корневой версии.
4. Иконки манифеста и обложки находятся по новому базовому пути (раньше `../images/` от `/backlog/v2/`).
5. Вход через Google возвращает на `/backlog/`, сессия и зеркало `bl2:*` из `/v2/` на месте (тот же домен).

---

### Task S1: Базовый путь `/backlog/`

**Files:** Modify `app/vite.config.ts` (база по умолчанию `/backlog/`; иконки манифеста `images/icon-*.png` от базы), `app/src/config.ts` (`ASSET_ROOT` = `import.meta.env.BASE_URL`, при сборке `/backlog/v2/` — `/backlog/`), `app/playwright.config.ts` (адрес `/backlog/`), `app/e2e/visual.spec.ts` (комментарий).

- [ ] e2e: манифест по `/backlog/manifest.webmanifest` отдаёт иконки, которые открываются (200, `image/png`). Сейчас падает (сборка на `/backlog/v2/`).
- [ ] Поменять базу и пути. Весь e2e зелёный на новом адресе.

### Task S2: Воркер убирает v1

**Files:** Create `app/public/sw-retire-v1.js`; Modify `app/vite.config.ts` (`workbox.importScripts`); Test `app/tests/pwa/retireV1.test.ts`.

**Interfaces:** `sw-retire-v1.js` — обработчик `activate`: `caches.delete('backlog-shell-v1')`, `caches.delete('backlog-covers-v1')`; если кэш оболочки v1 был, `clients.matchAll({ type: 'window' })` → `client.navigate(client.url)`.

- [ ] Юнит (скрипт выполняется в фейковом `self` с `caches`/`clients`): при кэшах v1 оба удалены и вкладки перезагружены; без кэшей v1 никто не перезагружен.
- [ ] Реализовать; в собранном `dist/sw.js` есть `importScripts("sw-retire-v1.js")`.

### Task S3: Старый адрес `/backlog/v2/`

**Files:** Create `app/retired-v2/index.html`, `app/retired-v2/sw.js`; Test `app/tests/pwa/retiredV2.test.ts`.

- [ ] Юнит «выключателя»: при активации удаляет кэши, в имени которых есть `/backlog/v2/`, не трогает остальные, снимает регистрацию, уводит вкладки на `/backlog/`.
- [ ] `index.html`: `location.replace('/backlog/' + location.hash)` и `<meta http-equiv="refresh">` на случай без JS.

### Task S4: Выкладка и CI без v1

**Files:** Modify `.github/workflows/deploy.yml`, `.github/workflows/ci.yml`.

- [ ] Deploy: `npm ci && npm test && npm run build` в `app/`; `_site` = `app/dist` + `images/` + `retired-v2/` в `_site/v2/`. Шаг тестов v1 убран. Проверка локально тем же скриптом сборки `_site`.
- [ ] CI: шаг «v1 tests» убран.

### Task S5: Удаление v1, README, история схемы

**Files:** Delete `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `data.js`, `lib/`, `tests/`, `tools/`; Create `supabase/migrations/20260925000000_baseline.sql` (SQL-блоки README v1 по порядку их выполнения); Modify `README.md` (v2: что это, как устроено, запуск, тесты, выкладка, где спеки и миграции).

- [ ] Удалить; `grep` по репозиторию не находит ссылок на удалённые файлы вне `docs/`.

## Порядок и проверка

S1 → S2 → S3 → S4 → S5, затем `npm test`, `typecheck`, `build`, `budget`, полный e2e, ревью ветки, PR, слияние, проверка запуска Deploy, сообщение Georgy. Канбан: BL-48 (C14) и BL-25 закрыть, новая карточка «через неделю убрать `/backlog/v2/` из Redirect URLs и `BL_BASE`».

## Отклонения при реализации

(заполняется по ходу)
