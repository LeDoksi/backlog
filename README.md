# Бэклог

Локальная галерея личного бэклога игр, сериалов, кино и аниме. Статический сайт — просто откройте `index.html` в браузере.

## Как это устроено

- `data.js` — базовый каталог тайтлов (редактируется вручную/через Claude).
- Статус просмотра, личная оценка, удаление и быстро добавленные черновики редактируются прямо в интерфейсе и хранятся в `localStorage` вашего браузера поверх `data.js` — три ключа:
  - `backlog-overrides` — правки полей тайтла (статус, оценка) по id;
  - `backlog-deleted` — id удалённых тайтлов из `data.js` (черновики сюда не попадают — они просто удаляются из `backlog-added`);
  - `backlog-added` — черновики, добавленные через форму быстрого добавления.
- Чтобы сбросить все локальные правки и вернуться к состоянию `data.js` "as is", очистите все три ключа в localStorage (DevTools → Application → Local Storage), либо в консоли браузера: `localStorage.removeItem('backlog-overrides'); localStorage.removeItem('backlog-deleted'); localStorage.removeItem('backlog-added');`.

## Как добавить новый тайтл

Просто попросите Claude добавить тайтл по названию — он найдёт год/жанры/синопсис/постер, скачает постер в `images/covers/`, допишет объект в `data.js` по схеме ниже и проверит каталог через `node tools/validate-data.js`.

Схема одного тайтла (см. `lib/validate.js` для точных правил):

```js
{
  id: "slug-year",                              // lib/slug.js makeId(title, year)
  title: "Название",
  category: "game" | "series" | "movie" | "anime",
  status: "queue" | "in_progress" | "done",
  airingStatus: "ongoing" | "completed" | null,  // null для game/movie
  year: 2024,
  genres: ["жанр1", "жанр2"],
  rating: null,                                   // 1-10 или null, задаётся пользователем в UI
  synopsis: "Краткое описание.",
  cover: "images/covers/slug-year.jpg",
  seasonInfo: "Вышло 2 сезона, 3-й анонсирован на 2026."  // опционально, только для series/anime, не валидируется
}
```

### Как устроены id

Есть ровно две конвенции, и они намеренно разные:

- **Каталог `data.js`** — `slug-year` (`dune-3-2026`), т.е. `BacklogSlug.makeId(title, year)`. Так выглядят все записи в каталоге.
- **Черновики быстрого добавления** — голый слаг без года (`dune-3`), потому что в форме быстрого добавления нет поля года. Генерируются через `BacklogSlug.uniqueId(name, existingIds)`, который при коллизии добавляет числовой суффикс (`dune-3`, `dune-3-2`, …).

Черновик считается «перекрытым» каталогом (`BacklogStorage.isSupersededBy` в `lib/storage.js`), если id каталожной записи либо точно равен id черновика, либо равен ему плюс суффикс из четырёх цифр — года. Поэтому черновик `dune-3` исчезает, когда в `data.js` появляется `dune-3-2026`, но не исчезает из-за не связанного с ним `dune-3000-2020`.

### Быстрое добавление

Также можно быстро добавить тайтл прямо в интерфейсе (только название + категория) — он появится как «черновик» с плейсхолдером, а полные данные (жанры/год/постер/описание/seasonInfo) вы допишете тем же способом, попросив Claude, когда будете готовы — черновик автоматически исчезнет, как только в `data.js` появится тайтл с соответствующим id (см. правило выше).

## Тесты

`lib/` — чистая логика (слаги, фильтры/сортировка, localStorage-оверлей, валидация) — покрыта тестами на встроенном тест-раннере Node (без установки зависимостей):

```bash
node --test tests/*.test.js
node tools/validate-data.js
```

(Note: the bare `node --test tests/` without a glob fails with `MODULE_NOT_FOUND` on this machine's Node version when run from this path — always use the `tests/*.test.js` glob form.)
