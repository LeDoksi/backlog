# C, доводка после проверки владельцем — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Исправить восемь замечаний Georgy к v2 на `/backlog/v2/` (2026-09-28) до шага C14 (замена v1).

**Architecture:** Точечные правки поверх кода фазы C (`app/`). Новых модулей два: `ui/scrollLock.ts` (блок прокрутки фона на телефоне) и чистая функция раскладки быстрого добавления. Остальное — CSS и параметры анимаций.

**Tech Stack:** как в плане C (React 19, Motion 12, Vitest, Playwright).

**Spec:** [`../specs/2026-09-25-redesign-social-design.md`](../specs/2026-09-25-redesign-social-design.md) §5–6; план [`2026-09-25-redesign-C-core.md`](2026-09-25-redesign-C-core.md). Замечания — сообщения Georgy в треде проекта 2026-09-28 22:47 и 22:48 (со скриншотами).

**Канбан:** BL-74…BL-81, эпик BL-E6, все блокируют BL-48 (C14).

## Global Constraints

- Поля ввода на телефоне не мельче 16px (иначе iOS Safari приближает страницу при фокусе).
- Бюджет JS 250KB gzip (`npm run budget`), axe без serious/critical, эталоны `e2e/visual.spec.ts-snapshots/` обновляются только после просмотра новых снимков.
- Замер закрытия панели делается на 222 тайтлах (размер бэклога владельца) с замедлением CPU ×4.

## Review Focus

1. Вложенные панели (тайтл → форма → подтверждение): блок прокрутки снимается только когда закрыта последняя. Тест: T1.
2. Список внутри панели (сезоны, жанры, результаты поиска) по-прежнему листается пальцем, когда фон заблокирован. Тест: T1.
3. Клавиатура Android (Chrome меняет высоту окна, а не visualViewport): компактный режим не включается, отступ под клавиатуру 0. Тест: T4.
4. Закрытие панели сразу после открытия другой карточки: общий постер летит только к последней открытой. Тест: T8.
5. Снимки экранов с «случайными» постерами стабильны: выбор идёт через подменяемый `Math.random`. Тест: T6.

---

### Task T1 (BL-74): Фон не листается под панелью на телефоне

**Причина:** `document.body.style.overflow = 'hidden'` в `Sheet` и `QuickAdd` iOS Safari при касании не соблюдает, прокрутка уходит к странице.

**Files:** Create `app/src/ui/scrollLock.ts`; Modify `app/src/ui/Sheet.tsx`, `app/src/screens/QuickAdd/QuickAdd.tsx`; Test `app/tests/ui/scrollLock.test.ts`.

**Interfaces:** Produces `lockScroll(): () => void` — счётчик блокировок; пока он больше нуля, `body` получает `overflow: hidden` (колесо мыши), а `touchmove` на документе отменяется, если палец не внутри элемента, который сам может прокручиваться (`overflow-y: auto|scroll` и `scrollHeight > clientHeight`). Возвращает функцию снятия (повторный вызов безвреден).

- [x] Тест: `lockScroll()` → `touchmove` на обычном элементе `defaultPrevented === true`; на элементе с прокруткой (`overflow-y: auto`, `scrollHeight` 500 > `clientHeight` 100) — `false`; две блокировки и одно снятие — фон всё ещё заблокирован; второе снятие — `body.style.overflow === ''` и `touchmove` не отменяется.
- [x] Прогнать, убедиться, что падает (модуля нет).
- [x] Реализовать `scrollLock.ts`; в `Sheet` и `QuickAdd` заменить ручное `overflow` на `const unlock = lockScroll(); return unlock;`.
- [x] Тесты зелёные, e2e `backlog`/`quick-add` зелёные. Commit.

### Task T2 (BL-75): Нет приближения при фокусе на поиске

**Files:** Modify `app/src/design/tokens.css` (`--fs-input: 16px`), CSS полей: `Backlog/BacklogHeader.module.css .input`, `EditTitle/EditTitle.module.css .input,.textarea`, `EditTitle/GenresField.module.css .input`, `EditTitle/PartsEditor.module.css .name,.yearInput`, `Profile/Profile.module.css .input`; Test `app/e2e/backlog.spec.ts`.

- [x] e2e (phone): открыть поиск, открыть форму редактирования и приглашение — у каждого видимого `input`/`textarea` вычисленный `font-size` ≥ 16px. Сейчас падает на поиске (15px).
- [x] Поставить `font-size: var(--fs-input)` во все перечисленные поля.
- [x] e2e зелёный. Commit.

### Task T3 (BL-76): Сортировка помещается в панели фильтров

**Причина:** `Segmented` с четырьмя подписями шире экрана 390px, панель получает горизонтальную прокрутку (скрин 1).

**Files:** Modify `app/src/screens/Backlog/FilterPanels.tsx` (сортировка в панели фильтров — переносящиеся чипы, как статусы; `role="radiogroup"`, у кнопок `role="radio"` и `aria-checked`), `FilterPanels.module.css`; Test `app/e2e/backlog.spec.ts`.

- [x] e2e (phone): открыть «Фильтры» — у тела панели `scrollWidth <= clientWidth`; выбрать «Название» — первая карточка по алфавиту.
- [x] Заменить `Segmented` на чипы-радио (стиль `.chip`, выбранный — `selected`).
- [x] e2e зелёный. Commit.

### Task T4 (BL-78): Больше результатов при открытой клавиатуре

**Причина:** на iPhone над клавиатурой ~310px; шапка, категории и поле занимают ~220px, остаётся одна строка (скрин 2).

**Files:** Create `app/src/screens/QuickAdd/layout.ts`; Modify `QuickAdd.tsx`, `QuickAdd.module.css`, `app/src/ui/useVisualViewport.ts` (добавить `layoutHeight: window.innerHeight`); Test `app/tests/screens/quickAddLayout.test.ts`, `app/e2e/quick-add.spec.ts`.

**Interfaces:** Produces `quickAddLayout(v: { layoutHeight: number; height: number; offsetTop: number }): { top: number; keyboard: number; compact: boolean }` — `keyboard = max(0, layoutHeight - height - offsetTop)`, `compact = keyboard > 120`, `top = offsetTop + 8`.

**Поведение:** панель прижата к верху видимой области (8px); при клавиатуре заголовок «Добавить тайтл» скрыт визуально (остаётся для чтеца экрана), крестик переезжает в строку категорий; список результатов продолжается за клавиатурой: у него `padding-bottom = keyboard`, так что любую строку можно поднять над клавиатурой прокруткой; строки результатов компактнее (постер 36×54).

- [x] Юнит: без клавиатуры (`844, 844, 0`) → `{ top: 8, keyboard: 0, compact: false }`; iOS с клавиатурой (`844, 400, 0`) → `keyboard 444, compact true`; Android (`500, 500, 0`) → `keyboard 0, compact false`.
- [x] e2e (phone): подменить `window.visualViewport` (высота 330, `offsetTop` 0) через `addInitScript`, найти «Дюна» с подменёнными ответами TMDb — поле ввода и первые две строки результатов целиком в пределах верхних 330px.
- [x] Реализовать. Тесты зелёные, эталоны `quick-add` пересняты и просмотрены. Commit.

### Task T5 (BL-79): Больше постеров на экране входа (компьютер)

**Files:** Modify `app/src/screens/SignIn.tsx` (стена из 30 обложек из `images/covers/`), `SignIn.module.css` (от 1024px: 10 колонок, ширина `max(1400px, 120vw)`, по центру; на телефоне видны первые 16).

- [x] Реализовать, пересоздать эталоны `sign-in`, просмотреть desktop и phone. Commit.

### Task T6 (BL-80): Итоги — больше постеров и новый набор при каждом заходе

**Было:** три последних по порядку добавления завершённых тайтла, поэтому F5 всегда показывал одно и то же.

**Files:** Modify `app/src/data/stats.ts` (убрать `recentDone`; добавить `showcase(titles: Title[], n: number, rand = Math.random): Title[]` — `n` случайных завершённых с настоящей обложкой, без повторов), `app/src/screens/Stats/Stats.tsx` (`useMemo` на время показа экрана: 3 на телефоне, 10 на компьютере двумя рядами), `Stats.module.css`; Test `app/tests/data/stats.test.ts`; `app/e2e/visual.spec.ts` (подмена `Math.random` на детерминированную последовательность).

- [x] Юнит: только `done`; без заглушки обложки; не больше `n`; разный `rand` → разный набор; меньше `n` завершённых → все.
- [x] Реализовать. Эталоны `stats` пересняты и просмотрены. Commit.

### Task T7 (BL-77): Панель на компьютере закрывается без зависания у края

**Причина:** на компьютере панель по центру, а выход — `y: '100%'` (на свою высоту), поэтому в конце она ещё видна у нижнего края, пока пружина не успокоится (скрин 5).

**Files:** Modify `app/src/ui/Sheet.tsx` (на `useIsDesktop()` вход и выход — `opacity` + `scale 0.96` + `y 16px`, 0.18с, без пружины и без перетаскивания); Test `app/e2e/desktop.spec.ts`.

- [x] e2e (desktop): открыть тайтл, Esc — через 350мс диалога нет в DOM.
- [x] Реализовать. e2e зелёный. Commit.

### Task T8 (BL-81): Закрытие смахиванием без рывка

**Причина (замер):** у всех 222 карточек был `layoutId` постера, и при закрытии Motion пересчитывал проекцию каждой. Долгие задачи при закрытии: ~310мс (CPU ×4); с `layoutId` только у открытой карточки — ~70–130мс, остальное — пересчёт раскладки.

**Files:** Modify `app/src/data/ui.ts` (поле `sharedTitleId`: ставится в `openTitle`, не сбрасывается в `closeTitle`), `app/src/screens/Backlog/TitleCard.tsx` (`layoutId` только если `sharedTitleId === title.id`); Test `app/tests/data/ui.test.ts`.

- [x] Юнит: `openTitle('a')` → `sharedTitleId 'a'`; `closeTitle()` → `openTitleId null`, `sharedTitleId 'a'`; `openTitle('b')` → `'b'`.
- [x] Реализовать, повторить замер (скрипт вне репозитория), e2e зелёные. Commit.

---

## Порядок и проверка

T8 → T7 → T1 → T2 → T3 → T4 → T5 → T6, затем полный прогон (`npm test`, `typecheck`, `budget`, e2e), ревью ветки (`superpowers:requesting-code-review`), PR, слияние и выкладка, сообщение Georgy, что проверить.

## Отклонения при реализации

- **Задачи выполнены в одной сессии, без скриптов task-start/task-done** (у задач идентификаторы T1..T8, а не «Task N»); журнал вёлся вручную.
- **T2:** эталонные снимки пересняты один раз в конце, после T3–T6, а не после каждой задачи — они всё равно менялись снова.
- **T5:** 36 обложек и 12 колонок вместо 30 и 10: при повороте стены 30 обложек оставляли пустой угол на экране 1920px.
- **T6:** на компьютере в ряду 2, 3 или 5 постеров в зависимости от ширины (видно 4, 6 или 10), а не всегда 10: десять постеров закрывали цифры на экранах уже 1700px. На самых узких (1024–1200px) веер сдвигается за правый край.
- **T8, пересмотрено после ревью:** общий постер карточки и панели (`layoutId`) убран совсем, `sharedTitleId` тоже. Motion читает `layoutId` только при первом рендере элемента, поэтому включать его одной карточке по нажатию не работает: перелёт не запускался, а карточка, перерисованная в момент открытия, оставалась связанной навсегда. Перелёт при открытии и так не был виден (постер въезжает вместе с панелью), а обратный перелёт при закрытии и был тем «обновлением карточки», которое видел Georgy. Это отступление от спецификации §6 («layoutId для перехода карточка → панель»); если перелёт понадобится, его вернуть через перемонтирование карточки с `key` до открытия панели.
- **Ревью ветки:** телефон на экране входа скачивал все 36 постеров (~3,4 МБ), хотя показывал 16; теперь рендерятся только видимые.

## Self-Review

- Все восемь замечаний покрыты: телефон 1 → T1, 2 → T2, 3 → T3, 4 → T4, смахивание → T8; компьютер 1 → T5, 2 → T6, 3 → T7.
- Заглушек нет; имена `lockScroll`, `quickAddLayout`, `showcase`, `sharedTitleId` едины во всех задачах.
