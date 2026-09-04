# Аутентификация и общие пространства — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** заменить полностью открытый анонимный доступ к Supabase на вход через Google-аккаунт, с данными, скоуплёнными по «пространствам» (workspace) — личным по умолчанию, объединяемым по приглашению.

**Architecture:** Supabase Auth со встроенным Google-провайдером; данные принадлежат `workspace`, не пользователю; `workspace_id` на всех четырёх существующих таблицах синхронизации + RLS `workspace_id = current_workspace_id()`; DB-триггер создаёт профиль при первом входе; три `security definer` RPC-функции (`invite_email`, `leave_workspace`, `remove_member`) выполняют межпользовательские операции, которые обычная RLS-политика безопасно не выразит.

**Tech Stack:** Supabase Auth (Google OAuth provider), Postgres RLS + `security definer` функции + триггер, ванильный JS (тот же UMD-паттерн `lib/*.js`, что и везде в проекте), без новых npm-зависимостей.

**Spec:** `docs/superpowers/specs/2026-09-04-auth-workspaces-design.md`

## Global Constraints

- Никаких новых npm-зависимостей — проект статический, без сборки, ровно как сейчас.
- Весь SQL идёт в `README.md` как документированные блоки, которые владелец сам выполняет в Supabase SQL Editor — ровно тот же паттерн, что и все прошлые миграции этого проекта (см. существующие разделы README про `overrides`/`parts`).
- Новый чистый JS-модуль — `lib/auth.js`, тот же UMD/DI-паттерн, что `lib/sync.js`: функции принимают `client` первым параметром, ничего не тянут из глобального `window` напрямую, тестируются против поддельного клиента без реальной сети.
- `lib/sync.js` **не меняется** — `workspace_id` заполняется в БД автоматически через `DEFAULT current_workspace_id()`, клиентский код никогда не должен явно его указывать.
- Каждая SQL-задача обязана включать шаг живой проверки через `curl`, что реально изменилось в базе — не «код написан», а «объект существует и ведёт себя как задумано». До Task 8 (настройка Google-провайдера) второго реального аутентифицированного аккаунта физически не существует — до этого момента доступная проверка это анонимный ключ (подтверждает, что RLS включена и анонимному доступу ничего не отдаёт, ровно как раньше при каждой миграции этого проекта). Проверка «второй реальный аккаунт не видит чужое пространство» — это отдельно, явно Task 8, Step 6, и именно там она с настоящим JWT.
- Реальные учётные данные Supabase уже есть в `app.js` (`SUPABASE_URL`/`SUPABASE_KEY`) — они не секрет (см. README), их можно использовать при живой проверке, но никогда не создавать/оставлять тестовые данные в проде без явной очистки.

---

### Task 1: Таблицы `workspaces`, `profiles`, `allowed_emails` + триггер автосоздания профиля

**Files:**
- Modify: `README.md` (новый раздел «Аутентификация и пространства» в конце раздела «Синхронизация»)

**Interfaces:**
- Produces: таблицы `workspaces(id uuid pk)`, `profiles(id uuid pk references auth.users, email text, workspace_id uuid)`, `allowed_emails(email text pk, invited_by uuid, workspace_id uuid)`; функция `current_workspace_id() returns uuid` (`security definer`); триггер `on_auth_user_created` на `auth.users`.

- [ ] **Step 1: Написать SQL-блок в README**

Добавить в `README.md` в конец раздела «Синхронизация» новый подраздел:

````markdown
## Аутентификация и пространства

С этого момента сайт закрыт: вход только через Google, данные принадлежат «пространству» (`workspace`), а не отдельному пользователю — у пары, которая делит бэклог, пространство одно на двоих, у нового человека — своё личное. Подробности решения — `docs/superpowers/specs/2026-09-04-auth-workspaces-design.md`.

### Схема

```sql
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  workspace_id uuid not null references workspaces(id),
  created_at timestamptz not null default now()
);

create table allowed_emails (
  email text primary key,
  invited_by uuid references auth.users(id),
  workspace_id uuid references workspaces(id),
  created_at timestamptz not null default now()
);

alter table workspaces enable row level security;
alter table profiles enable row level security;
alter table allowed_emails enable row level security;

-- current_workspace_id() — security definer, чтобы политика на profiles могла
-- смотреть в саму profiles без рекурсии RLS (стандартный паттерн Supabase).
create or replace function current_workspace_id() returns uuid
language sql stable security definer set search_path = public
as $$
  select workspace_id from profiles where id = auth.uid()
$$;

-- Участники своего пространства видны друг другу (нужно для панели
-- участников) — сами пространства и allowed_emails с клиента не читаются
-- вообще (мониторинг — через Table Editor в дашборде, см. спеку).
create policy "read own workspace profiles" on profiles for select
  using (workspace_id = current_workspace_id());

-- Разрешено вставлять/обновлять только свои собственные приглашения —
-- реальная запись в allowed_emails всё равно идёт через invite_email() (Task 3),
-- но политика тут на случай прямого вызова.
create policy "insert own invites" on allowed_emails for insert
  with check (invited_by = auth.uid());
create policy "update own invites" on allowed_emails for update
  using (invited_by = auth.uid());

-- Создаёт профиль при первом входе. Если email не приглашён — профиль не
-- создаётся вовсе, и RLS ниже по всей базе блокирует всё для этого auth.uid().
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  invite record;
  new_workspace uuid;
begin
  -- lower(trim(...)) on both sides of every email comparison in this file —
  -- an invite typed as "Friend@Gmail.com" must still match the exact string
  -- Google hands back on sign-in.
  select * into invite from allowed_emails where email = lower(trim(new.email));
  if not found then
    return new;
  end if;
  if invite.workspace_id is not null then
    insert into profiles (id, email, workspace_id) values (new.id, new.email, invite.workspace_id);
  else
    insert into workspaces default values returning id into new_workspace;
    insert into profiles (id, email, workspace_id) values (new.id, new.email, new_workspace);
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
```

Выполнить в Supabase SQL Editor.
````

- [ ] **Step 2: Владелец выполняет SQL**

Попросить владельца выполнить блок из Step 1 в Supabase SQL Editor и подтвердить `Success. No rows returned` (тот же паттерн, что во всех прошлых миграциях этого проекта).

- [ ] **Step 3: Проверить, что таблицы реально созданы**

```bash
curl -s "https://rjdnpwamcxvhryiigbvt.supabase.co/rest/v1/workspaces?select=*&limit=1" \
  -H "apikey: sb_publishable_omYttbkLjxA-DDxQAXU9Mw_AguNLqto" \
  -H "Authorization: Bearer sb_publishable_omYttbkLjxA-DDxQAXU9Mw_AguNLqto"
```

Ожидается `[]` (таблица есть, пуста, RLS ничего анонимному ключу не даёт — если бы таблицы не было, был бы `relation "workspaces" does not exist`).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: schema for workspaces/profiles/allowed_emails + first-login trigger"
```

---

### Task 2: `workspace_id` на существующих таблицах, RLS, миграция текущих данных

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `current_workspace_id()` (Task 1).
- Produces: колонка `workspace_id uuid not null default current_workspace_id()` на `overrides`/`deleted_titles`/`drafts`/`parts`; переписанные RLS-политики этих четырёх таблиц.

- [ ] **Step 1: Добавить SQL-блок в README**

Добавить сразу после блока Task 1:

````markdown
### Существующие таблицы синхронизации

Каждая из четырёх таблиц (`overrides`, `deleted_titles`, `drafts`, `parts`) получает `workspace_id`. Колонка **сначала добавляется nullable** и заполняется существующим строкам, и только потом становится `not null` с дефолтом — тот же осторожный порядок, что уже спасал этот проект от истории с NULL-артефактами после прошлой миграции (см. запись в `.superpowers/sdd/2026-08-16-backlog-plan/progress.md` про инцидент с рейтингами): колонку с `not null default` от старта нельзя аккуратно добавить на таблицу с уже существующими строками без бэкофилла.

```sql
alter table overrides add column if not exists workspace_id uuid references workspaces(id);
alter table deleted_titles add column if not exists workspace_id uuid references workspaces(id);
alter table drafts add column if not exists workspace_id uuid references workspaces(id);
alter table parts add column if not exists workspace_id uuid references workspaces(id);
```

Дальше — одноразовая миграция: одно общее пространство на существующие данные, и владелец с девушкой сразу туда приглашены.

```sql
do $$
declare
  main_workspace uuid;
begin
  insert into workspaces default values returning id into main_workspace;

  update overrides set workspace_id = main_workspace where workspace_id is null;
  update deleted_titles set workspace_id = main_workspace where workspace_id is null;
  update drafts set workspace_id = main_workspace where workspace_id is null;
  update parts set workspace_id = main_workspace where workspace_id is null;

  insert into allowed_emails (email, workspace_id) values
    ('shakov.georgy@gmail.com', main_workspace),
    ('dashach98@gmail.com', main_workspace);
end $$;
```

Теперь колонки можно закрыть для новых пустых значений — вставки без `workspace_id` подставят его сами через `DEFAULT`:

```sql
alter table overrides
  alter column workspace_id set not null,
  alter column workspace_id set default current_workspace_id();
alter table deleted_titles
  alter column workspace_id set not null,
  alter column workspace_id set default current_workspace_id();
alter table drafts
  alter column workspace_id set not null,
  alter column workspace_id set default current_workspace_id();
alter table parts
  alter column workspace_id set not null,
  alter column workspace_id set default current_workspace_id();
```

И RLS — с «разрешено всем» на «только своё пространство»:

```sql
drop policy "allow all - overrides" on overrides;
drop policy "allow all - deleted_titles" on deleted_titles;
drop policy "allow all - drafts" on drafts;
drop policy "allow all - parts" on parts;

create policy "workspace members - overrides" on overrides for all
  using (workspace_id = current_workspace_id())
  with check (workspace_id = current_workspace_id());
create policy "workspace members - deleted_titles" on deleted_titles for all
  using (workspace_id = current_workspace_id())
  with check (workspace_id = current_workspace_id());
create policy "workspace members - drafts" on drafts for all
  using (workspace_id = current_workspace_id())
  with check (workspace_id = current_workspace_id());
create policy "workspace members - parts" on parts for all
  using (workspace_id = current_workspace_id())
  with check (workspace_id = current_workspace_id());
```

**Клиентский код не меняется.** `lib/sync.js` строит вставляемые строки из фиксированного списка полей (`OVERRIDE_FIELDS`/`DRAFT_FIELDS`) — `workspace_id` в этот список никогда не входит, значит клиент никогда не пытается его передать, и `DEFAULT current_workspace_id()` заполняет его на стороне базы для каждой новой строки автоматически, от лица того, кто реально аутентифицирован в момент записи.
````

- [ ] **Step 2: Email девушки уже известен и подставлен**

`dashach98@gmail.com` — уже в SQL-блоке Step 1 выше, ничего спрашивать не нужно.

- [ ] **Step 3: Владелец выполняет SQL**

Выполнить в Supabase SQL Editor по порядку (все блоки Step 1 — это одна логическая миграция, но `alter table add column` / бэкофилл / `set not null` / RLS должны идти именно в этом порядке, не одним куском вперемешку).

- [ ] **Step 4: Проверить бэкофилл и RLS живым запросом**

```bash
curl -s "https://rjdnpwamcxvhryiigbvt.supabase.co/rest/v1/overrides?select=id,workspace_id&limit=3" \
  -H "apikey: sb_publishable_omYttbkLjxA-DDxQAXU9Mw_AguNLqto" \
  -H "Authorization: Bearer sb_publishable_omYttbkLjxA-DDxQAXU9Mw_AguNLqto"
```

Ожидается **пустой массив `[]`** — не потому что данных нет (они есть), а потому что анонимный ключ теперь ничего не может прочитать без сессии: это и есть подтверждение, что RLS реально заменилась, а не осталась открытой. (До этой задачи тот же запрос вернул бы все строки.)

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: workspace_id on sync tables, RLS rewrite, one-time data migration"
```

---

### Task 3: RPC-функции `invite_email`, `leave_workspace`, `remove_member`

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `profiles`, `allowed_emails`, `workspaces` (Task 1), `current_workspace_id()` (Task 1).
- Produces: `invite_email(target_email text, add_to_my_workspace boolean)`, `leave_workspace()`, `remove_member(target_user_id uuid)` — все три `security definer`, вызываются через `client.rpc(...)`.

- [ ] **Step 1: Добавить SQL-блок в README**

````markdown
### Приглашение, выход, удаление участника

Три функции с повышенными правами (`security definer`) — обычная RLS-политика не может безопасно выразить «изменить чужую строку `profiles` при выполнении условия», это ровно тот случай, для которого `security definer`-функции и существуют в Postgres/Supabase.

```sql
-- Пригласить email: даёт доступ к сайту всегда; добавляет в своё
-- пространство только если add_to_my_workspace = true. Если этот email уже
-- когда-то заходил (у него уже есть profiles) и чекбокс включён — применяет
-- смену пространства сразу, а не ждёт несуществующего повторного «первого
-- входа». Не включённый чекбокс никогда не откатывает уже существующее
-- назначение пространства этого email — только явное включение чекбокса
-- когда-либо меняет workspace_id в allowed_emails.
create or replace function invite_email(target_email text, add_to_my_workspace boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  my_workspace uuid;
  target_profile_id uuid;
begin
  select workspace_id into my_workspace from profiles where id = auth.uid();
  -- Without this, an anonymous caller (auth.uid() is null, my_workspace stays
  -- null too) still reaches the insert below — security definer runs as the
  -- function owner, which bypasses allowed_emails' own RLS policy entirely,
  -- so the "insert own invites" check is never evaluated on this path. That
  -- would let anyone holding the public anon key self-grant site access with
  -- no real invite. Found by review before this ever reached production.
  if my_workspace is null then
    raise exception 'not a workspace member';
  end if;

  insert into allowed_emails (email, invited_by, workspace_id)
  values (
    lower(trim(target_email)),
    auth.uid(),
    case when add_to_my_workspace then my_workspace else null end
  )
  on conflict (email) do update
    set invited_by = excluded.invited_by,
        workspace_id = case
          when add_to_my_workspace then excluded.workspace_id
          else allowed_emails.workspace_id
        end;

  if add_to_my_workspace then
    select id into target_profile_id from profiles where email = lower(trim(target_email));
    if target_profile_id is not null then
      update profiles set workspace_id = my_workspace where id = target_profile_id;
    end if;
  end if;
end;
$$;

-- Выйти из своего пространства: только если там больше одного участника —
-- иначе выходить некуда, это уже личное пространство.
create or replace function leave_workspace() returns void
language plpgsql security definer set search_path = public
as $$
declare
  my_workspace uuid;
  member_count int;
  new_workspace uuid;
begin
  select workspace_id into my_workspace from profiles where id = auth.uid();
  select count(*) into member_count from profiles where workspace_id = my_workspace;
  if member_count <= 1 then
    raise exception 'cannot leave a workspace you are the only member of';
  end if;
  insert into workspaces default values returning id into new_workspace;
  update profiles set workspace_id = new_workspace where id = auth.uid();
end;
$$;

-- Вывести другого участника из СВОЕГО пространства (любой участник может
-- вывести любого другого — см. спеку, «Модель безопасности»). Тот же
-- запрет на «остаться пустым» пространством.
create or replace function remove_member(target_user_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
declare
  my_workspace uuid;
  target_workspace uuid;
  member_count int;
  new_workspace uuid;
begin
  select workspace_id into my_workspace from profiles where id = auth.uid();
  select workspace_id into target_workspace from profiles where id = target_user_id;
  if target_workspace is null or target_workspace != my_workspace then
    raise exception 'target is not in your workspace';
  end if;
  select count(*) into member_count from profiles where workspace_id = my_workspace;
  if member_count <= 1 then
    raise exception 'cannot remove the only member of a workspace';
  end if;
  insert into workspaces default values returning id into new_workspace;
  update profiles set workspace_id = new_workspace where id = target_user_id;
end;
$$;

-- Belt and braces alongside each function's own auth.uid()/my_workspace
-- guard: the anon key (public by design, ships in the client bundle) must
-- never be able to invoke any of these three at all. leave_workspace and
-- remove_member already fail safely for an anonymous caller on their own
-- member_count check, but revoking here means that's never load-bearing —
-- PostgREST returns a permission-denied error before the function body ever
-- runs, for all three, regardless of what each function's internals do.
revoke execute on function invite_email(text, boolean) from anon;
revoke execute on function leave_workspace() from anon;
revoke execute on function remove_member(uuid) from anon;
```
````

- [ ] **Step 2: Владелец выполняет SQL**

Выполнить в Supabase SQL Editor.

- [ ] **Step 3: Проверить, что функции видны через RPC-эндпоинт и анонимному ключу в них действительно отказано**

**Важно, найдено ревью до выполнения этого SQL в проде** (SQL ещё никогда не выполнялся владельцем, эта функция физически не существовала в базе — так что ничего похожего ниже реально не произошло, только могло бы): до добавления guard-проверки `if my_workspace is null then raise exception ...` и `revoke execute ... from anon` в SQL-блок Task 3 выше, анонимный ключ мог бы вызвать `invite_email` и реально вставить строку в `allowed_emails` — то есть самостоятельно выдать себе доступ на «закрытый» сайт в обход всей модели приглашений. Оба SQL-блока Task 3 выше уже содержат исправление. Проверить именно это здесь, а не вслепую доверять, что синтаксис сам всё решил:

```bash
curl -s -X POST "https://rjdnpwamcxvhryiigbvt.supabase.co/rest/v1/rpc/invite_email" \
  -H "apikey: sb_publishable_omYttbkLjxA-DDxQAXU9Mw_AguNLqto" \
  -H "Authorization: Bearer sb_publishable_omYttbkLjxA-DDxQAXU9Mw_AguNLqto" \
  -H "Content-Type: application/json" \
  -d '{"target_email":"test@example.com","add_to_my_workspace":false}'
```

Ожидается ошибка **прав доступа** (permission denied for function / 42501), а не `Could not find the function` (значит SQL не выполнился — вернуться к Step 2) и не тихий успех (значит `revoke` не применился или применился не к той сигнатуре функции — проверить `text, boolean` совпадает буквально). Дополнительно — прямой SQL-запрос в Supabase SQL Editor подтверждает, что тестовая строка нигде не осела:

```sql
select * from allowed_emails where email = 'test@example.com';
```

Ожидается пусто.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: invite_email/leave_workspace/remove_member RPC functions"
```

---

### Task 4: `lib/auth.js` — чистая обёртка над Supabase Auth

**Files:**
- Create: `lib/auth.js`
- Test: `tests/auth.test.js`

**Interfaces:**
- Produces: `BacklogAuth.signInWithGoogle(client)`, `.signOut(client)`, `.getSession(client)`, `.onAuthStateChange(client, callback)`, `.hasProfile(client)`, `.listWorkspaceMembers(client)`, `.inviteEmail(client, email, addToMyWorkspace)`, `.leaveWorkspace(client)`, `.removeMember(client, userId)`.

- [ ] **Step 1: Прочитать `lib/sync.js` целиком для соблюдения конвенции**

Открыть `lib/sync.js` — обратить внимание на: UMD-обёртку в начале файла, паттерн `createClient` (внедряемый SDK, а не глобальный `window.supabase`), и на то, что каждая функция принимает `client` первым аргументом и безопасно деградирует при `!client` (никогда не бросает).

- [ ] **Step 2: Написать падающие тесты**

Создать `tests/auth.test.js`:

```js
// tests/auth.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Auth = require('../lib/auth.js');

function fakeClient(overrides) {
  var base = {
    auth: {
      signInWithOAuth: function () { return Promise.resolve({ data: {}, error: null }); },
      signOut: function () { return Promise.resolve({ error: null }); },
      getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } } }
    },
    from: function () {
      return { select: function () { return Promise.resolve({ data: [], error: null }); } };
    },
    rpc: function () { return Promise.resolve({ data: null, error: null }); }
  };
  return Object.assign(base, overrides);
}

test('signInWithGoogle calls signInWithOAuth with the google provider', async () => {
  var seen = null;
  var client = fakeClient({
    auth: {
      signInWithOAuth: function (opts) { seen = opts; return Promise.resolve({ data: {}, error: null }); }
    }
  });
  await Auth.signInWithGoogle(client);
  assert.deepEqual(seen, { provider: 'google' });
});

test('signInWithGoogle without a client resolves to an error, never throws', async () => {
  var result = await Auth.signInWithGoogle(null);
  assert.equal(result.error.message, 'no client');
});

test('getSession returns null session when there is no client', async () => {
  var result = await Auth.getSession(null);
  assert.equal(result.data.session, null);
});

test('getSession returns the real session when a client is present', async () => {
  var fakeSession = { user: { id: 'u1' } };
  var client = fakeClient({
    auth: {
      getSession: function () { return Promise.resolve({ data: { session: fakeSession }, error: null }); }
    }
  });
  var result = await Auth.getSession(client);
  assert.deepEqual(result.data.session, fakeSession);
});

test('signOut calls client.auth.signOut and returns its result', async () => {
  var called = false;
  var client = fakeClient({
    auth: {
      signOut: function () { called = true; return Promise.resolve({ error: null }); }
    }
  });
  var result = await Auth.signOut(client);
  assert.equal(called, true);
  assert.deepEqual(result, { error: null });
});

test('signOut without a client resolves with no error, never throws', async () => {
  var result = await Auth.signOut(null);
  assert.equal(result.error, null);
});

test('onAuthStateChange forwards the callback and returns an unsubscribable handle', () => {
  var seenCallback = null;
  var unsubscribeCalled = false;
  var client = fakeClient({
    auth: {
      onAuthStateChange: function (cb) {
        seenCallback = cb;
        return { data: { subscription: { unsubscribe: function () { unsubscribeCalled = true; } } } };
      }
    }
  });
  var myCallback = function () {};
  var handle = Auth.onAuthStateChange(client, myCallback);
  assert.equal(seenCallback, myCallback);
  handle.unsubscribe();
  assert.equal(unsubscribeCalled, true);
});

test('onAuthStateChange without a client returns a no-op unsubscribable handle', () => {
  var handle = Auth.onAuthStateChange(null, function () {});
  assert.doesNotThrow(function () { handle.unsubscribe(); });
});

test('hasProfile is true when the profiles query returns a row', async () => {
  var client = fakeClient({
    from: function (table) {
      assert.equal(table, 'profiles');
      return { select: function () { return { maybeSingle: function () {
        return Promise.resolve({ data: { id: 'u1' }, error: null });
      } }; } };
    }
  });
  assert.equal(await Auth.hasProfile(client), true);
});

test('hasProfile is false when the profiles query returns no row', async () => {
  var client = fakeClient({
    from: function () {
      return { select: function () { return { maybeSingle: function () {
        return Promise.resolve({ data: null, error: null });
      } }; } };
    }
  });
  assert.equal(await Auth.hasProfile(client), false);
});

test('hasProfile without a client resolves false, never throws', async () => {
  assert.equal(await Auth.hasProfile(null), false);
});

test('listWorkspaceMembers returns the rows from the profiles table', async () => {
  var client = fakeClient({
    from: function (table) {
      assert.equal(table, 'profiles');
      return { select: function () {
        return Promise.resolve({ data: [{ id: 'u1', email: 'a@x.com' }], error: null });
      } };
    }
  });
  var members = await Auth.listWorkspaceMembers(client);
  assert.deepEqual(members, [{ id: 'u1', email: 'a@x.com' }]);
});

test('listWorkspaceMembers without a client resolves to an empty list', async () => {
  assert.deepEqual(await Auth.listWorkspaceMembers(null), []);
});

test('inviteEmail calls the invite_email RPC with the right arguments', async () => {
  var seenName = null, seenArgs = null;
  var client = fakeClient({
    rpc: function (name, args) { seenName = name; seenArgs = args; return Promise.resolve({ data: null, error: null }); }
  });
  await Auth.inviteEmail(client, 'friend@example.com', true);
  assert.equal(seenName, 'invite_email');
  assert.deepEqual(seenArgs, { target_email: 'friend@example.com', add_to_my_workspace: true });
});

test('leaveWorkspace calls the leave_workspace RPC with no arguments', async () => {
  var seenName = null;
  var client = fakeClient({
    rpc: function (name) { seenName = name; return Promise.resolve({ data: null, error: null }); }
  });
  await Auth.leaveWorkspace(client);
  assert.equal(seenName, 'leave_workspace');
});

test('removeMember calls the remove_member RPC with the target id', async () => {
  var seenName = null, seenArgs = null;
  var client = fakeClient({
    rpc: function (name, args) { seenName = name; seenArgs = args; return Promise.resolve({ data: null, error: null }); }
  });
  await Auth.removeMember(client, 'u2');
  assert.equal(seenName, 'remove_member');
  assert.deepEqual(seenArgs, { target_user_id: 'u2' });
});

test('inviteEmail/leaveWorkspace/removeMember without a client resolve to an error, never throw', async () => {
  assert.equal((await Auth.inviteEmail(null, 'x@x.com', false)).error.message, 'no client');
  assert.equal((await Auth.leaveWorkspace(null)).error.message, 'no client');
  assert.equal((await Auth.removeMember(null, 'u1')).error.message, 'no client');
});
```

- [ ] **Step 2b: Запустить тесты, убедиться что падают на "Cannot find module"**

Run: `node --test tests/auth.test.js`
Expected: FAIL — `Cannot find module '../lib/auth.js'`

- [ ] **Step 3: Написать `lib/auth.js`**

```js
// lib/auth.js
//
// Тонкая обёртка над Supabase Auth и тремя RPC-функциями пространств —
// тот же DI-паттерн, что lib/sync.js: клиент передаётся явно, ничего не
// читается из глобального window, ни одна функция не бросает (сеть/auth —
// всегда «может не получиться», это состояние, а не исключение).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.BacklogAuth = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  function noClientError() {
    return { data: null, error: { message: 'no client' } };
  }

  // Resolves `run()`'s result no matter what, including a client that
  // throws synchronously — same shape as lib/sync.js's selectAll/attempt:
  // a `try` around the call itself, not just a `.catch` on its promise,
  // since `client.from(...)`/`client.rpc(...)` can throw before ever
  // returning a promise to chain onto.
  function guarded(run, onError) {
    try {
      return Promise.resolve(run()).catch(function (e) { return onError(e); });
    } catch (e) {
      return Promise.resolve(onError(e));
    }
  }

  function signInWithGoogle(client) {
    if (!client) return Promise.resolve(noClientError());
    return guarded(
      function () { return client.auth.signInWithOAuth({ provider: 'google' }); },
      function (e) { return { data: null, error: e || { message: 'unknown' } }; }
    );
  }

  function signOut(client) {
    if (!client) return Promise.resolve({ error: null });
    return guarded(
      function () { return client.auth.signOut(); },
      function (e) { return { error: e || { message: 'unknown' } }; }
    );
  }

  function getSession(client) {
    if (!client) return Promise.resolve({ data: { session: null }, error: null });
    return guarded(
      function () { return client.auth.getSession(); },
      function (e) { return { data: { session: null }, error: e || { message: 'unknown' } }; }
    );
  }

  // Returns an unsubscribe-capable handle either way, so a caller can always
  // call `.unsubscribe()` on the result without a client-presence check.
  function onAuthStateChange(client, callback) {
    if (!client) return { unsubscribe: function () {} };
    try {
      var result = client.auth.onAuthStateChange(callback);
      return (result && result.data && result.data.subscription)
        ? result.data.subscription
        : { unsubscribe: function () {} };
    } catch (e) {
      return { unsubscribe: function () {} };
    }
  }

  function hasProfile(client) {
    if (!client) return Promise.resolve(false);
    return guarded(
      function () { return client.from('profiles').select('id').maybeSingle(); },
      function () { return null; }
    ).then(function (res) { return !!(res && res.data); });
  }

  function listWorkspaceMembers(client) {
    if (!client) return Promise.resolve([]);
    return guarded(
      function () { return client.from('profiles').select('id, email'); },
      function () { return null; }
    ).then(function (res) { return (res && Array.isArray(res.data)) ? res.data : []; });
  }

  function inviteEmail(client, email, addToMyWorkspace) {
    if (!client) return Promise.resolve(noClientError());
    return guarded(
      function () {
        return client.rpc('invite_email', {
          target_email: email,
          add_to_my_workspace: !!addToMyWorkspace
        });
      },
      function (e) { return { data: null, error: e || { message: 'unknown' } }; }
    );
  }

  function leaveWorkspace(client) {
    if (!client) return Promise.resolve(noClientError());
    return guarded(
      function () { return client.rpc('leave_workspace'); },
      function (e) { return { data: null, error: e || { message: 'unknown' } }; }
    );
  }

  function removeMember(client, userId) {
    if (!client) return Promise.resolve(noClientError());
    return guarded(
      function () { return client.rpc('remove_member', { target_user_id: userId }); },
      function (e) { return { data: null, error: e || { message: 'unknown' } }; }
    );
  }

  return {
    signInWithGoogle: signInWithGoogle,
    signOut: signOut,
    getSession: getSession,
    onAuthStateChange: onAuthStateChange,
    hasProfile: hasProfile,
    listWorkspaceMembers: listWorkspaceMembers,
    inviteEmail: inviteEmail,
    leaveWorkspace: leaveWorkspace,
    removeMember: removeMember
  };
}));
```

- [ ] **Step 4: Запустить тесты, убедиться что проходят**

Run: `node --test tests/auth.test.js`
Expected: все тесты PASS.

- [ ] **Step 5: Запустить полный набор тестов проекта**

Run: `node --test tests/*.test.js`
Expected: все тесты (существующие + новые из `auth.test.js`) PASS, счётчик вырос ровно на количество новых тестов.

- [ ] **Step 6: Commit**

```bash
git add lib/auth.js tests/auth.test.js
git commit -m "feat: lib/auth.js — DI wrapper over Supabase Auth and workspace RPCs"
```

---

### Task 5: Экран входа + экран «не приглашён», гейт перед всем приложением

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `BacklogAuth.getSession`, `.signInWithGoogle`, `.signOut`, `.hasProfile`, `.onAuthStateChange` (Task 4).

- [ ] **Step 1: Добавить разметку в `index.html`**

Сразу после `<body>`, перед существующим `<header class="topbar">`:

```html
<div id="auth-gate" class="auth-gate" hidden>
  <div class="auth-gate__card">
    <h1 class="auth-gate__title">Бэклог</h1>
    <button id="auth-signin" class="auth-gate__signin" type="button">Войти через Google</button>
  </div>
</div>

<div id="auth-blocked" class="auth-gate" hidden>
  <div class="auth-gate__card">
    <h1 class="auth-gate__title">Бэклог</h1>
    <p class="auth-gate__message">Этот аккаунт пока не приглашён.</p>
    <button id="auth-blocked-signout" class="auth-gate__signin" type="button">Выйти</button>
  </div>
</div>
```

Обернуть весь существующий контент — от `<header class="topbar">` до закрывающего `</body>` (не включая сам `</body>` и уже загруженные `<script>`-теги в самом низу) — в `<div id="app-root" hidden>...</div>`. Скрипты (`lib/*.js`, `data.js`, `app.js`) остаются вне этого div, они должны загружаться независимо от состояния гейта.

- [ ] **Step 2: Подключить `lib/auth.js` в `index.html`**

Добавить рядом с остальными `lib/*.js` тегами (перед `data.js`, как и все остальные `lib/`-модули):

```html
<script src="lib/auth.js"></script>
```

- [ ] **Step 3: Стили гейта в `styles.css`**

Добавить рядом с существующими модальными стилями (переиспользовать `--surface`, `--bg`, `--accent-bright`, `--sp-*`, `--fs-*` — никаких новых сырых значений):

```css
/* ── Auth gate ──────────────────────────────────────────────────────── */
.auth-gate {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  z-index: 100;
}
.auth-gate[hidden] { display: none; }
.auth-gate__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-4);
  padding: var(--sp-6);
  text-align: center;
}
.auth-gate__title {
  font-family: var(--font-display);
  font-size: var(--fs-lg);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: var(--text);
}
.auth-gate__message {
  color: var(--text-muted);
  font-size: var(--fs-sm);
  max-width: 320px;
}
.auth-gate__signin {
  padding: var(--sp-3) var(--sp-5);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-control);
  background: var(--surface);
  color: var(--text);
  font-size: var(--fs-sm);
  cursor: pointer;
}
.auth-gate__signin:hover { border-color: var(--accent-bright); }
```

(Если в `styles.css` уже нет какого-то из этих токенов под этим именем — открыть `:root` в начале файла и подставить реально существующее имя вместо предполагаемого; не изобретать новый сырой цвet.)

- [ ] **Step 4: Гейт-логика в `app.js`**

Найти в `app.js` самый конец IIFE — блок, начинающийся с `populateGenreFilter(); updateRandomAvailability(); refresh();` и заканчивающийся привязкой `startSync` к `DOMContentLoaded` (искать точный текст `if (document.readyState === 'loading')`). Обернуть всё содержимое IIFE, которое сейчас выполняется безусловно при загрузке (весь код от объявлений `state`/функций и ниже НЕ трогать — трогать только сам факт немедленного запуска `populateGenreFilter()`/`refresh()`/`startSync()`), в функцию `bootApp()`, и вызывать её только после успешной проверки сессии:

```js
  var authGate = document.getElementById('auth-gate');
  var authBlocked = document.getElementById('auth-blocked');
  var appRoot = document.getElementById('app-root');
  var authClient = (typeof window !== 'undefined' && window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;
  // Set inside evaluateSession below, read by Task 7's members panel to tell
  // "this row is me" (→ Выйти) apart from "this row is someone else" (→
  // Удалить) — declared here, not in Task 7, so it exists before anything
  // that might read it does.
  var currentUserId = null;

  function showGate() {
    appRoot.hidden = true;
    authBlocked.hidden = true;
    authGate.hidden = false;
  }

  function showBlocked() {
    appRoot.hidden = true;
    authGate.hidden = true;
    authBlocked.hidden = false;
  }

  function showApp() {
    authGate.hidden = true;
    authBlocked.hidden = true;
    appRoot.hidden = false;
  }

  document.getElementById('auth-signin').addEventListener('click', function () {
    Auth.signInWithGoogle(authClient);
  });
  document.getElementById('auth-blocked-signout').addEventListener('click', function () {
    Auth.signOut(authClient).then(showGate);
  });

  function bootApp() {
    populateGenreFilter();
    updateRandomAvailability();
    refresh();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startSync);
    } else {
      startSync();
    }
  }

  var booted = false;
  function evaluateSession() {
    if (!authClient) { showGate(); return; }
    Auth.getSession(authClient).then(function (res) {
      var session = res && res.data && res.data.session;
      if (!session) { currentUserId = null; showGate(); return; }
      currentUserId = session.user && session.user.id;
      return Auth.hasProfile(authClient).then(function (ok) {
        if (!ok) { showBlocked(); return; }
        showApp();
        if (!booted) { booted = true; bootApp(); }
      });
    });
  }

  Auth.onAuthStateChange(authClient, function () { evaluateSession(); });
  evaluateSession();
```

Разместить этот блок **в самом конце файла**, после определения `startSync`/`populateGenreFilter`/`refresh`/всех остальных функций, ровно на месте прежнего безусловного `populateGenreFilter(); updateRandomAvailability(); refresh();` + привязки `startSync`. Не удалять и не менять сами функции `bootApp` внутри — только то, что раньше выполнялось сразу, теперь выполняется из `bootApp()`, вызываемого условно.

**Важно:** `Auth` в этом блоке — глобальный `window.BacklogAuth`, подключённый как `<script>` в Task 4/Step 2. Завести его тем же способом, каким в файле уже заведён guarded `Sync` (искать `var Sync = (typeof BacklogSync !== 'undefined' ...`, около строки 69) — разместить рядом со всеми остальными переменными Step 4 этого шага:

```js
  var Auth = (typeof BacklogAuth !== 'undefined' && BacklogAuth) ? BacklogAuth : {
    signInWithGoogle: function () { return Promise.resolve({ data: null, error: { message: 'no client' } }); },
    signOut: function () { return Promise.resolve({ error: null }); },
    getSession: function () { return Promise.resolve({ data: { session: null }, error: null }); },
    onAuthStateChange: function () { return { unsubscribe: function () {} }; },
    hasProfile: function () { return Promise.resolve(false); },
    listWorkspaceMembers: function () { return Promise.resolve([]); },
    inviteEmail: function () { return Promise.resolve({ data: null, error: { message: 'no client' } }); },
    leaveWorkspace: function () { return Promise.resolve({ data: null, error: { message: 'no client' } }); },
    removeMember: function () { return Promise.resolve({ data: null, error: { message: 'no client' } }); }
  };
```

- [ ] **Step 5: Ручная проверка в браузере**

Запустить локальный статический сервер (`.claude/launch.json`, конфигурация `backlog-static`), открыть страницу — должен показаться экран входа, не бэклог. Кнопка «Войти через Google» должна вызывать `signInWithOAuth` (реальный редирект на Google не сработает, пока не настроен провайдер в Supabase — это Task 8; на этом шаге достаточно убедиться, что клик не роняет страницу и вызывает нужный SDK-метод — проверить через `read_network_requests`/консоль, что запрос к Supabase Auth действительно ушёл).

- [ ] **Step 6: Запустить полный набор тестов**

Run: `node --test tests/*.test.js` и `node tools/validate-data.js`
Expected: всё зелёное, без изменений в количестве (эта задача — DOM/UI-код, новых `lib/*.js`-тестов не добавляет).

- [ ] **Step 7: Commit**

```bash
git add index.html app.js styles.css
git commit -m "feat: auth gate — sign-in screen, not-invited screen, gate app boot behind a session"
```

---

### Task 6: Кнопка «Пригласить»

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `BacklogAuth.inviteEmail` (Task 4).

- [ ] **Step 1: Разметка в `index.html`**

В топбаре, рядом с `#sync-status` (искать `id="sync-status"` — вставить сразу после этого элемента внутри `.topbar__brand`, либо рядом, если `sync-status` не в `topbar__brand` — свериться с фактической текущей структурой топбара перед вставкой):

```html
<button id="invite-open" class="topbar__invite" type="button" aria-haspopup="dialog">Пригласить</button>
```

Рядом с остальными модалками (искать `id="stats-modal"` как образец структуры — тот же паттерн `role="dialog" aria-modal="true"`):

```html
<div id="invite-modal" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="invite-title">
  <div class="modal__backdrop"></div>
  <div class="modal__panel">
    <h2 id="invite-title" class="modal__title">Пригласить</h2>
    <form id="invite-form">
      <label class="edit-form__field">
        <span class="modal__field-label">Email</span>
        <input id="invite-email" class="edit-form__input" type="email" required>
      </label>
      <label class="edit-form__checkbox">
        <input id="invite-add-to-workspace" type="checkbox">
        Добавить в моё пространство
      </label>
      <p id="invite-error" class="edit-form__error" hidden role="alert"></p>
      <div class="modal__actions">
        <button id="invite-cancel" type="button" class="edit-form__cancel">Отмена</button>
        <button type="submit" class="edit-form__save">Отправить</button>
      </div>
    </form>
  </div>
</div>
```

(Классы `edit-form__field`/`edit-form__checkbox`/`edit-form__input`/`edit-form__error`/`edit-form__cancel`/`edit-form__save`/`modal__field-label`/`modal__actions`/`modal__title`/`modal__backdrop`/`modal__panel` уже существуют и стилизованы — переиспользовать один в один, не создавать параллельные классы под то же самое.)

- [ ] **Step 2: Стили кнопки в топбаре**

Добавить в `styles.css` рядом с `.sync-status`/`.toolbar__stats`-подобными правилами:

```css
.topbar__invite {
  font-family: var(--font-display);
  font-size: var(--fs-micro);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: var(--text-muted);
  background: transparent;
  border: none;
  cursor: pointer;
}
.topbar__invite:hover { color: var(--text); }
```

- [ ] **Step 3: Логика в `app.js`**

Разместить рядом с остальной модальной логикой (искать `openStatsModal`/`closeStatsModal` как образец — тот же паттерн открытия/закрытия, включая `inert` на фон, если он уже применяется к другим модалкам через `syncModalBackground` — проверить сигнатуру этой функции и добавить `invite-modal` в её учёт тем же способом, каким туда уже добавлена шторка фильтров в Task 47 из основного плана):

```js
  var inviteModal = document.getElementById('invite-modal');
  var inviteForm = document.getElementById('invite-form');
  var inviteEmailInput = document.getElementById('invite-email');
  var inviteAddToWorkspaceInput = document.getElementById('invite-add-to-workspace');
  var inviteError = document.getElementById('invite-error');

  function openInviteModal() {
    inviteError.hidden = true;
    inviteEmailInput.value = '';
    inviteAddToWorkspaceInput.checked = false;
    inviteModal.hidden = false;
    syncModalBackground();
    inviteEmailInput.focus();
  }

  function closeInviteModal() {
    inviteModal.hidden = true;
    syncModalBackground();
  }

  document.getElementById('invite-open').addEventListener('click', openInviteModal);
  document.getElementById('invite-cancel').addEventListener('click', closeInviteModal);
  inviteModal.querySelector('.modal__backdrop').addEventListener('click', closeInviteModal);

  inviteForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var email = inviteEmailInput.value.trim();
    if (!email) return;
    Auth.inviteEmail(authClient, email, inviteAddToWorkspaceInput.checked).then(function (res) {
      if (res && res.error) {
        inviteError.textContent = 'Не удалось отправить приглашение';
        inviteError.hidden = false;
        return;
      }
      closeInviteModal();
    });
  });
```

**Важно, конкретная правка.** `syncModalBackground` (искать `function syncModalBackground()`, около строки 882) определяет блокировку фона так:

```js
var modal = !document.getElementById('title-modal').hidden || !statsModal.hidden;
```

Тело функции уже пропускает при обходе `document.body.children` любой элемент с классом `modal` (`if (el.classList.contains('modal')) return;`) — значит сама `#invite-modal` (у неё уже есть `class="modal"` из Step 1) корректно не заинертится сама себя. Но переменная `modal`, которая решает, инертить ли **всё остальное**, про `invite-modal` ничего не знает — открытие только этой модалки не заблокирует фон вообще. Заменить строку на:

```js
var modal = !document.getElementById('title-modal').hidden || !statsModal.hidden || !inviteModal.hidden;
```

(`inviteModal` — переменная `document.getElementById('invite-modal')`, объявленная чуть выше в этом же шаге; убедиться, что она объявлена **до** первого вызова `syncModalBackground()`, то есть до конца файла, где `evaluateSession`/`bootApp` из Task 5 её тоже могут дёрнуть.)

- [ ] **Step 4: Ручная проверка**

В браузере: открыть модалку приглашения, ввести email, отправить без реального Supabase RPC (пока Task 8 не выполнена, вызов вернёт ошибку авторизации — это ожидаемо на этом шаге) — убедиться, что форма корректно показывает `invite-error` вместо падения страницы.

- [ ] **Step 5: Тесты и коммит**

Run: `node --test tests/*.test.js` и `node tools/validate-data.js` — без изменений в счётчике.

```bash
git add index.html app.js styles.css
git commit -m "feat: invite button and modal wired to invite_email RPC"
```

---

### Task 7: Панель участников — список, выход, удаление

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `styles.css`

**Interfaces:**
- Consumes: `BacklogAuth.listWorkspaceMembers`, `.leaveWorkspace`, `.removeMember` (Task 4).

- [ ] **Step 1: Разметка в `index.html`**

Добавить кнопку рядом с `#invite-open` (та же группа в топбаре):

```html
<button id="members-open" class="topbar__invite" type="button" aria-haspopup="dialog">Участники</button>
```

Модалка, рядом с `#invite-modal`:

```html
<div id="members-modal" class="modal" hidden role="dialog" aria-modal="true" aria-labelledby="members-title">
  <div class="modal__backdrop"></div>
  <div class="modal__panel">
    <h2 id="members-title" class="modal__title">Участники пространства</h2>
    <ul id="members-list" class="members-list"></ul>
    <div class="modal__actions">
      <button id="members-close" type="button" class="edit-form__cancel">Закрыть</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Стили списка участников**

```css
.members-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  list-style: none;
  padding: 0;
  margin: var(--sp-4) 0;
}
.members-list__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  font-size: var(--fs-sm);
  color: var(--text);
}
.members-list__remove {
  font-size: var(--fs-micro);
  color: var(--accent-bright);
  background: transparent;
  border: none;
  cursor: pointer;
}
```

- [ ] **Step 3: Логика в `app.js`**

```js
  var membersModal = document.getElementById('members-modal');
  var membersList = document.getElementById('members-list');
  // currentUserId уже объявлена и заполняется в evaluateSession (Task 5) —
  // используется здесь как есть, повторно не объявляется.

  function memberRowHtml(member) {
    var safeEmail = escapeHtml(member.email);
    var isSelf = member.id === currentUserId;
    var actionLabel = isSelf ? 'Выйти' : 'Удалить';
    return '<li class="members-list__row">' +
      '<span>' + safeEmail + (isSelf ? ' (вы)' : '') + '</span>' +
      '<button class="members-list__remove" data-member-id="' + escapeHtml(member.id) + '" data-self="' + (isSelf ? '1' : '0') + '">' +
      actionLabel + '</button></li>';
  }

  function renderMembers(members) {
    // Кнопка выхода/удаления скрыта целиком, если участник в пространстве
    // ровно один — выходить/удалять некого, плодить пустое пространство
    // незачем (см. спеку, «Удаление участника и выход из пространства»).
    var soleMember = members.length <= 1;
    membersList.innerHTML = members.map(function (m) {
      var row = memberRowHtml(m);
      return soleMember ? row.replace(/<button[^>]*>.*?<\/button>/, '') : row;
    }).join('');
  }

  function openMembersModal() {
    Auth.listWorkspaceMembers(authClient).then(renderMembers);
    membersModal.hidden = false;
    syncModalBackground();
  }

  function closeMembersModal() {
    membersModal.hidden = true;
    syncModalBackground();
  }

  document.getElementById('members-open').addEventListener('click', openMembersModal);
  document.getElementById('members-close').addEventListener('click', closeMembersModal);
  membersModal.querySelector('.modal__backdrop').addEventListener('click', closeMembersModal);

  membersList.addEventListener('click', function (event) {
    var btn = event.target.closest('.members-list__remove');
    if (!btn) return;
    var isSelf = btn.dataset.self === '1';
    var action = isSelf
      ? Auth.leaveWorkspace(authClient)
      : Auth.removeMember(authClient, btn.dataset.memberId);
    action.then(function (res) {
      if (res && res.error) return; // RPC уже отверг некорректное состояние (например, remove_member на не-своего) — тихо не обновляем список
      if (isSelf) { closeMembersModal(); return; }
      Auth.listWorkspaceMembers(authClient).then(renderMembers);
    });
  });
```

**Важно:** `escapeHtml` уже существует в `app.js` — переиспользовать существующую функцию, не писать новую.

**Та же правка `syncModalBackground`, что и в Task 6** — снова расширить строку `var modal = ...` (на этот раз она уже содержит `|| !inviteModal.hidden` из Task 6):

```js
var modal = !document.getElementById('title-modal').hidden || !statsModal.hidden || !inviteModal.hidden || !membersModal.hidden;
```

`membersModal` — `document.getElementById('members-modal')`, объявленная в Step 3 этой задачи выше.

- [ ] **Step 4: Ручная проверка**

В браузере: открыть панель участников — до Task 8 (реальный вход) список будет пуст (RLS не пропустит анонимный запрос), это ожидаемо; убедиться, что отсутствие данных не ломает рендер (`renderMembers([])` не должен бросать).

- [ ] **Step 5: Тесты и коммит**

Run: `node --test tests/*.test.js` и `node tools/validate-data.js` — без изменений в счётчике.

```bash
git add index.html app.js styles.css
git commit -m "feat: members panel — list, leave, remove (hidden when workspace has one member)"
```

---

### Task 8: Google OAuth provider + сквозная живая проверка

**Files:**
- Modify: `README.md` (инструкция по настройке провайдера — не SQL, а шаги в Google Cloud Console и в дашборде Supabase)

**Interfaces:**
- Consumes: всё из Task 1-7.

- [ ] **Step 1: Инструкция в README**

Добавить в README рядом с остальной документацией по Supabase короткий раздел:

````markdown
### Настройка входа через Google (разовая, вручную)

1. [Google Cloud Console](https://console.cloud.google.com/) → создать OAuth-клиент (тип «Web application»), Authorized redirect URI — взять из Supabase Dashboard → Authentication → Providers → Google (там показан готовый callback URL проекта).
2. Supabase Dashboard → Authentication → Providers → Google → включить, вставить Client ID/Secret из шага 1.
3. Authentication → URL Configuration → добавить реальный домен сайта (`https://ledoksi.github.io`) в Redirect URLs.
````

- [ ] **Step 2: Владелец настраивает провайдера**

Владелец выполняет шаги из Step 1 сам (внешние аккаунты — Google Cloud Console и Supabase Dashboard, недоступны для автоматизации отсюда).

- [ ] **Step 3: Живая проверка — владелец**

Владелец открывает сайт, входит через свой Google-аккаунт (уже в `allowed_emails` с `workspace_id` основного пространства по Task 2) — должен увидеть весь текущий бэклог как есть, без единой потери данных.

- [ ] **Step 4: Живая проверка — девушка**

Девушка входит своим Google-аккаунтом (тоже уже в `allowed_emails` из Task 2) — должна увидеть **тот же самый** общий бэклог, что и владелец, и любое изменение с одного аккаунта должно доехать до другого (та же realtime-подписка, что и раньше, просто теперь через авторизованную сессию).

- [ ] **Step 5: Живая проверка — приглашение друга**

Владелец через кнопку «Пригласить» (Task 6) добавляет email друга **без** чекбокса «Добавить в моё пространство». Друг заходит через Google — должен увидеть **пустой** бэклог (своё личное новое пространство), не видеть ни одного из тайтлов владельца.

- [ ] **Step 6: Живая проверка — RLS реально блокирует чужое**

От лица аккаунта друга (реальная сессия, реальный JWT) выполнить:

```bash
curl -s "https://rjdnpwamcxvhryiigbvt.supabase.co/rest/v1/overrides?select=*" \
  -H "apikey: sb_publishable_omYttbkLjxA-DDxQAXU9Mw_AguNLqto" \
  -H "Authorization: Bearer <JWT_ДРУГА_ИЗ_DEVTOOLS>"
```

(JWT взять из `localStorage` браузера друга после входа — Supabase Auth кладёt сессию в ключ вида `sb-<project-ref>-auth-token`.) Ожидается пустой список или только собственные данные друга — **ни одной** строки, принадлежащей пространству владельца.

- [ ] **Step 7: Живая проверка — выход/удаление**

Владелец открывает панель участников (Task 7) в своём (общем с девушкой) пространстве — должна быть видна кнопка выхода у себя и удаления у девушки (участников двое). Открывает ту же панель в контексте друга (если есть доступ к его сессии для теста, либо друг проверяет сам) — кнопки не должно быть вовсе (участник один).

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs: Google OAuth provider setup instructions"
```

---

## Self-review notes

- **Spec coverage:** экран входа/«не приглашён» (Task 5) ← спека «Экран входа»; кнопка приглашения + чекбокс с дефолтом выключен (Task 6) ← спека «Приглашение»; удаление/выход с запретом на пустое пространство (Task 7) ← спека «Удаление участника и выход из пространства»; RLS-модель и `workspace_id`-миграция (Task 2) ← спека «Модель» + «Миграция существующих данных»; RPC-функции с той самой логикой «пригласить уже существующего пользователя сразу» (Task 3) ← спека «Приглашение уже существующего пользователя»; мониторинг через Table Editor, не через приложение (сознательно нет отдельной задачи на in-app admin-панель) ← спека «Мониторинг»; `lib/sync.js` не меняется ← Global Constraints + Task 2 явно об этом.
- **Type consistency:** `BacklogAuth.inviteEmail(client, email, addToMyWorkspace)` в Task 4 и его вызов в Task 6 (`Auth.inviteEmail(authClient, email, inviteAddToWorkspaceInput.checked)`) совпадают по сигнатуре. `listWorkspaceMembers`/`leaveWorkspace`/`removeMember` — то же самое между Task 4 и Task 7. RPC-имена (`invite_email`/`leave_workspace`/`remove_member`) и их параметры (`target_email`/`add_to_my_workspace`/`target_user_id`) идентичны между SQL в Task 3 и JS-обёрткой в Task 4.
- **Порядок задач и принцип «сначала UI, потом реальный auth» (из памяти о предпочтениях владельца):** Task 5-7 строят весь экран входа, форму приглашения и панель участников, ссылаясь на реальные вызовы `lib/auth.js` — но без рабочего Google-провайдера (настраивается только в Task 8) все эти вызовы будут возвращать ошибку авторизации, а не падать. Это и есть тот самый «сначала спроектировать/собрать весь UI, реальный внешний auth подключить последним шагом» — здесь «последний шаг» это не код, а настройка OAuth-клиента в Google Cloud Console, которая физически не может быть сделана раньше остального (провайдеру нужен callback URL из уже существующего Supabase-проекта).
