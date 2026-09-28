# Бэклог

Игры, сериалы, кино и аниме, до которых хочется добраться. Личный и общий на двоих бэклог: вход через Google по приглашению, данные в Supabase, работает офлайн и ставится на экран «Домой».

Адрес: https://ledoksi.github.io/backlog/

## Как устроено

- `app/` — приложение: React 19, TypeScript, Vite, Zustand, Motion, PWA через `vite-plugin-pwa`.
  - `src/lib/` — чистая логика без React: слаги и id, фильтры и сортировка, оверлей правок, валидация, синхронизация, поиск по внешним источникам.
  - `src/data/` — сторы и связь с Supabase: тайтлы (`titlesStore.ts`), синхронизация (`syncEngine.ts`), сессия, фильтры, итоги.
  - `src/screens/` — экраны: вход, бэклог, панель тайтла, редактирование, быстрое добавление, итоги, профиль.
  - `src/ui/` — общие компоненты, `src/design/` — токены и темы.
  - `retired-v2/` — страница-переадресация и воркер для старого адреса `/backlog/v2/` (там жила v2 до замены v1).
- `images/` — обложки (`images/covers/`) и иконки, публикуются по `/backlog/images/`.
- `supabase/migrations/` — схема базы по шагам. Первый файл — снимок схемы, какой её оставила v1.
- `worker/proxy.js` — CORS-прокси на Cloudflare для Steam и TMDb, выкладывается вручную через панель Cloudflare.
- `docs/superpowers/` — спеки и планы редизайна (фазы A–D), `docs/design/` — макеты.

## Данные и синхронизация

Таблицы `drafts` (тайтлы), `overrides` (правки поверх них: статус и изменённые поля) и `parts` (отмеченные сезоны) привязаны к пространству (`workspace`). Доступ ограничен RLS: каждый видит только своё пространство. Вход — только для приглашённых email (`allowed_emails`, триггер `handle_new_user`).

В браузере у приложения зеркало этих таблиц в `localStorage` с префиксом `bl2:`. Правка сразу пишется в зеркало и показывается, затем уходит в Supabase; без сети она ждёт в очереди и отправляется при появлении сети. При запуске очередь отправляется до того, как скачивается общее состояние. Чужие правки приходят через realtime; пока открыта панель или форма, перерисовка откладывается.

Ключи в `app/src/config.ts` (Supabase publishable, TMDb, RAWG) — клиентские: браузер обязан предъявлять их сам, данные защищены RLS.

## Запуск и проверки

```bash
cd app
npm install
npm run dev          # http://localhost:5173/backlog/
npm test             # модульные тесты (Vitest)
npm run typecheck
npm run build && npm run budget   # сборка и бюджет JS 250 KB gzip
npm run e2e          # Playwright: телефон и компьютер, доступность, снимки экранов
```

Снимки экранов: `app/e2e/visual.spec.ts-snapshots/`. Переснять после намеренных изменений: `npx playwright test e2e/visual.spec.ts --update-snapshots`, затем просмотреть новые снимки.

## Выкладка

`.github/workflows/deploy.yml` на каждый push в `master`: тесты, сборка, сайт из `app/dist` + `images/` + `app/retired-v2/` в `/v2/`, публикация на GitHub Pages. `ci.yml` гоняет тесты, сборку с бюджетом и e2e на каждом PR.

## Supabase: настройки вне кода

- Authentication → Providers → Google: OAuth-клиент из Google Cloud Console.
- Authentication → URL Configuration: Site URL и Redirect URLs — `https://ledoksi.github.io/backlog/`. Без полного пути сессия теряется после входа.
- Новый участник: приглашение из профиля в приложении. Первый вход до того, как email приглашён, создаёт пользователя без профиля — приложение покажет «не приглашён».
