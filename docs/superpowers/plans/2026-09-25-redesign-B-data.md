# B. Модель данных v2 и доски — план реализации

> **Где лежат документы (для любой сессии, в том числе локальной).** Спека, планы, дизайн-система и макеты закоммичены в ветку **`claude/loving-rubin-mh121x`** репозитория `LeDoksi/backlog`. Пока она не слита в `master`, работать нужно от неё:
> ```bash
> git fetch origin claude/loving-rubin-mh121x
> git checkout claude/loving-rubin-mh121x
> ```
> Если ветка уже слита, те же файлы лежат в `master`, берите оттуда. Задачи и порядок работ — в канбане: Supabase-проект `kanban` (`qcxfaxgqjzabtrzpsnnm`), проект `backlog`, эпики BL-E5…BL-E8.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Перед стартом:** подпроект C завершён, v1 удалена. Запустить `superpowers:writing-plans` для B и развернуть задачи в шаги по 2–5 минут против текущего кода. SQL ниже — целевой, его можно уточнять только если он не применяется к реальной схеме (сверить `list_tables` перед каждой миграцией).

**Goal:** Перейти на одну таблицу `titles`, профили с ником, личную и общую доску с переключением, приглашением в общую доску по нику и копированием между досками (BL-24); дозаполнить внешние ID; включить периоды в «Итогах».

**Architecture:** Новые таблицы создаются рядом со старыми, данные переносятся скриптом с проверкой, клиент переключается одним релизом, старые таблицы удаляются через неделю. Все операции со членством — RPC `security definer`; прямой записи в `workspace_members` нет.

**Tech Stack:** Postgres 17 (Supabase), расширение `citext`, pgTAP для SQL-тестов, Node 22 + `@supabase/supabase-js` (service role) для скриптов.

**Spec:** разделы 6.1, 6.3, 6.5, 6.7, 6.8, 7.1, 7.2, 7.3 (часть досок и профиля), 7.5 (даты), 7.6, 8.

## Global Constraints

Все пункты [индекса](2026-09-25-redesign-social-plan.md#global-constraints), плюс:
- Каждая миграция — отдельный файл `supabase/migrations/<timestamp>_<name>.sql`, применяется через Supabase MCP `apply_migration` или `supabase db push` и коммитится.
- Перед первой миграцией — полная резервная копия (B1, шаг 1). Удаление старых таблиц только в B10, не раньше чем через 7 дней после B5.
- Сервисный ключ Supabase (`SUPABASE_SERVICE_ROLE_KEY`) только в переменной окружения при запуске скриптов, никогда в репозитории и в канбане.
- Email пользователя не возвращается ни одной функцией, кроме `my_boards` участникам своей доски (как сейчас в панели участников).

## Review Focus

1. Производный статус и ручной статус переносятся без изменений: скрипт сверки B4 обязан показать 0 расхождений.
2. Лимит «одна личная + одна общая» держится и при гонке двух приглашений: проверка в триггере, не только в RPC. Тест: `board_limits.sql`.
3. Приглашённый в общую доску попадает в неё только после принятия. Тест: `board_invites.sql`.
4. После переключения клиента старые ключи `bl2:backlog-*` не мешают: клиент B при первом запуске очищает зеркало старой схемы и тянет `titles`. Тест: B5.
5. Старые завершённые тайтлы не получают `completed_at = now()` при переносе, иначе лидерборд месяца «взорвётся». Тест: `titles_touch.sql`.

---

### Task B1: Профили, доски, членство, таблица `titles`

**Files:** Create `supabase/migrations/20261005000000_boards_profiles_titles.sql`, `supabase/tests/board_limits.sql`, `supabase/tests/titles_rls.sql`.

- [ ] **Step 1: Backup** — выгрузить `drafts`, `overrides`, `parts`, `profiles`, `workspaces`, `allowed_emails` в JSON (`select json_agg(t) from <table> t` через MCP `execute_sql`) в файлы вне репозитория, плюс ручной бэкап в дашборде Supabase. Записать дату в задачу канбана.

- [ ] **Step 2: Migration SQL**

```sql
create extension if not exists citext;

-- Profiles gain identity and privacy settings; workspace_id stays until B10
-- because the C client still reads it through current_workspace_id().
alter table public.profiles
  add column if not exists display_name text,
  add column if not exists nickname citext,
  add column if not exists theme text not null default 'system',
  add column if not exists in_leaderboard boolean not null default false,
  add column if not exists share_activity boolean not null default true,
  add column if not exists share_matches boolean not null default true,
  add column if not exists findable_by_nick boolean not null default true,
  add column if not exists feed_seen_at timestamptz;
alter table public.profiles add constraint profiles_nickname_key unique (nickname);
alter table public.profiles add constraint profiles_nickname_format check (nickname is null or nickname::text ~ '^[a-z0-9_]{3,20}$');
alter table public.profiles add constraint profiles_theme_check check (theme in ('system', 'light', 'dark'));

alter table public.workspaces
  add column if not exists kind text not null default 'personal',
  add column if not exists visibility text not null default 'private',
  add column if not exists created_by uuid references auth.users(id);
alter table public.workspaces add constraint workspaces_kind_check check (kind in ('personal', 'shared'));
alter table public.workspaces add constraint workspaces_visibility_check check (visibility in ('private', 'friends', 'everyone'));

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members (user_id);

create or replace function public.enforce_board_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  select kind into k from workspaces where id = new.workspace_id;
  if exists (
    select 1 from workspace_members m join workspaces w on w.id = m.workspace_id
    where m.user_id = new.user_id and w.kind = k and m.workspace_id <> new.workspace_id
  ) then
    raise exception 'board_limit: already has a % board', k using errcode = 'P0001';
  end if;
  if k = 'personal' and exists (select 1 from workspace_members where workspace_id = new.workspace_id and user_id <> new.user_id) then
    raise exception 'board_limit: personal board has a single member' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger workspace_members_limits before insert on public.workspace_members
  for each row execute function public.enforce_board_limits();

create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = ws and user_id = auth.uid());
$$;

create table public.titles (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  title text not null,
  original_title text,
  category text not null check (category in ('game', 'series', 'movie', 'anime')),
  status text not null default 'queue' check (status in ('queue', 'in_progress', 'done', 'unreleased')),
  manual_status text check (manual_status in ('queue', 'in_progress', 'done', 'unreleased')),
  airing_status text check (airing_status in ('ongoing', 'completed')),
  year int,
  genres jsonb not null default '[]'::jsonb,
  synopsis text not null default '',
  cover text,
  season_info text,
  platforms jsonb,
  parts jsonb,
  checked_parts jsonb not null default '{}'::jsonb,
  source text,
  source_id text,
  hidden boolean not null default false,
  rating int,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index titles_source_idx on public.titles (source, source_id);
create index titles_completed_idx on public.titles (completed_at) where completed_at is not null;

alter table public.titles enable row level security;
create policy "members read titles" on public.titles for select using (public.is_member(workspace_id));
create policy "members insert titles" on public.titles for insert with check (public.is_member(workspace_id));
create policy "members update titles" on public.titles for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy "members delete titles" on public.titles for delete using (public.is_member(workspace_id));

alter table public.workspace_members enable row level security;
create policy "see members of my boards" on public.workspace_members for select using (public.is_member(workspace_id));

create policy "see my boards" on public.workspaces for select using (public.is_member(id));

alter publication supabase_realtime add table public.titles;
```

- [ ] **Step 3: SQL tests (pgTAP)** — `supabase/tests/board_limits.sql`: второй `personal` для одного пользователя → ошибка `board_limit`; второй `shared` → ошибка; второй участник в `personal` → ошибка; два участника в одном `shared` → ок. `supabase/tests/titles_rls.sql`: под `set local role authenticated` + `request.jwt.claims` пользователя A — не видит и не пишет `titles` доски B; видит свои.

Пример формы теста:

```sql
begin;
select plan(3);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@test'), ('00000000-0000-0000-0000-00000000000b', 'b@test');
insert into public.workspaces (id, kind) values ('10000000-0000-0000-0000-000000000001', 'personal'), ('10000000-0000-0000-0000-000000000002', 'personal');
insert into public.workspace_members values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', now());
select throws_like(
  $$insert into public.workspace_members values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', now())$$,
  'board_limit%', 'second personal board is rejected');
select throws_like(
  $$insert into public.workspace_members values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', now())$$,
  'board_limit%', 'personal board takes a single member');
insert into public.workspaces (id, kind) values ('10000000-0000-0000-0000-000000000003', 'shared');
insert into public.workspace_members values ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', now());
select lives_ok(
  $$insert into public.workspace_members values ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000b', now())$$,
  'shared board takes a second member');
select * from finish();
rollback;
```

- [ ] **Step 4: Apply, run tests, commit** — `apply_migration` на проде; тесты на локальном Supabase (`supabase start && supabase test db`), если Docker недоступен — на ветке проекта Supabase. Коммит `feat(db): boards, members and the unified titles table`.

---

### Task B2: Триггеры `titles`: даты статуса и `updated_at`

**Files:** Create `supabase/migrations/20261005000100_titles_touch.sql`, `supabase/tests/titles_touch.sql`.

```sql
-- Timestamps follow status changes. A row inserted with a created_at in the
-- past is a migrated title: its dates are unknown, so they stay as given
-- instead of pretending it was finished today.
create or replace function public.titles_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    if new.created_at < now() - interval '1 minute' then return new; end if;
    if new.status = 'in_progress' then new.started_at := coalesce(new.started_at, now()); end if;
    if new.status = 'done' then new.completed_at := coalesce(new.completed_at, now()); end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'in_progress' and new.started_at is null then new.started_at := now(); end if;
    if new.status = 'done' then new.completed_at := now(); end if;
    if old.status = 'done' and new.status <> 'done' then new.completed_at := null; end if;
  end if;
  return new;
end $$;
create trigger titles_touch before insert or update on public.titles
  for each row execute function public.titles_touch();
```

**Tests:** вставка `done` с `created_at = now()` → `completed_at` заполнен; вставка `done` с `created_at = '2026-01-01'` → `completed_at is null`; `done → queue` → `completed_at is null`; `queue → in_progress` → `started_at` заполнен и не меняется при повторном входе в `in_progress`.

---

### Task B3: Регистрация, профиль, мои доски, тема

**Files:** Create `supabase/migrations/20261005000200_signup_profile.sql`, `supabase/tests/signup.sql`; Modify `app/src/lib/auth.ts` (+ тесты).

```sql
create or replace function public.complete_signup() returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  em text;
  full_name text;
  allowed record;
  ws uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if exists (select 1 from profiles where id = uid) then return json_build_object('status', 'exists'); end if;
  select u.email, u.raw_user_meta_data->>'full_name' into em, full_name from auth.users u where u.id = uid;
  select * into allowed from allowed_emails a where lower(a.email) = lower(em);
  if allowed is null then return json_build_object('status', 'not_invited'); end if;
  insert into workspaces (kind, created_by) values ('personal', uid) returning id into ws;
  insert into profiles (id, email, workspace_id, display_name) values (uid, em, ws, full_name);
  insert into workspace_members (workspace_id, user_id) values (ws, uid);
  if allowed.workspace_id is not null then
    insert into board_invites (workspace_id, from_user, to_user)
    values (allowed.workspace_id, coalesce(allowed.invited_by, uid), uid)
    on conflict (from_user, to_user) do nothing;
  end if;
  return json_build_object('status', 'created');
end $$;

create or replace function public.nickname_available(p_nickname text) returns boolean
language sql stable security definer set search_path = public as $$
  select lower(p_nickname) ~ '^[a-z0-9_]{3,20}$'
     and not exists (select 1 from profiles where nickname = lower(p_nickname) and id <> auth.uid());
$$;

create or replace function public.set_profile(p_display_name text, p_nickname text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if lower(p_nickname) !~ '^[a-z0-9_]{3,20}$' then raise exception 'nickname_format' using errcode = 'P0001'; end if;
  update profiles set display_name = nullif(trim(p_display_name), ''), nickname = lower(p_nickname) where id = auth.uid();
exception when unique_violation then
  raise exception 'nickname_taken' using errcode = 'P0001';
end $$;

create or replace function public.set_theme(p_theme text) returns void
language sql security definer set search_path = public as $$
  update profiles set theme = p_theme where id = auth.uid() and p_theme in ('system', 'light', 'dark');
$$;

create or replace function public.my_profile() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('id', id, 'display_name', display_name, 'nickname', nickname, 'theme', theme,
    'in_leaderboard', in_leaderboard, 'share_activity', share_activity, 'share_matches', share_matches,
    'findable_by_nick', findable_by_nick) from profiles where id = auth.uid();
$$;

create or replace function public.my_boards() returns table (id uuid, kind text, visibility text, title_count int, members json)
language sql stable security definer set search_path = public as $$
  select w.id, w.kind, w.visibility,
    (select count(*)::int from titles t where t.workspace_id = w.id),
    (select json_agg(json_build_object('id', p.id, 'name', coalesce(p.display_name, split_part(p.email, '@', 1)), 'nickname', p.nickname, 'email', p.email) order by m2.joined_at)
       from workspace_members m2 join profiles p on p.id = m2.user_id where m2.workspace_id = w.id)
  from workspaces w join workspace_members m on m.workspace_id = w.id
  where m.user_id = auth.uid()
  order by (w.kind = 'shared');
$$;

-- Email invites now only grant access to the app; joining a board is a separate, accepted invite.
create or replace function public.invite_email(target_email text) returns void
language sql security definer set search_path = public as $$
  insert into allowed_emails (email, invited_by) values (lower(trim(target_email)), auth.uid())
  on conflict (email) do nothing;
$$;
```

`complete_signup` ссылается на `board_invites`, поэтому эта миграция **начинается** с блока `create table if not exists public.board_invites …` и его RLS из задачи B6 (скопировать дословно в начало файла). RPC приглашений остаются в B6; повторный `create table if not exists` там ничего не ломает.

`auth.ts`: `completeSignup(client)`, `nicknameAvailable(client, nick)`, `setProfile(client, name, nick)`, `setTheme(client, theme)`, `myProfile(client)`, `myBoards(client)`, `inviteEmail(client, email)` — тем же `guarded`-паттерном, что остальные функции файла.

**Tests (SQL):** не приглашённый → `not_invited` и профиль не создан; приглашённый → профиль + личная доска + членство; повторный вызов → `exists`; `set_profile` с занятым ником → `nickname_taken`; с `ABC` → сохраняется `abc`.

---

### Task B4: Перенос данных в `titles` и доски

**Files:** Create `supabase/migrations/20261005000300_boards_data.sql`, `app/tools/migrate-v2.ts`, `app/tools/README.md`; Test `app/tests/tools/migrate-v2.test.ts`.

**SQL (доски):**
```sql
update public.workspaces w set
  kind = case when (select count(*) from public.profiles p where p.workspace_id = w.id) >= 2 then 'shared' else 'personal' end,
  created_by = (select p.id from public.profiles p where p.workspace_id = w.id order by p.created_at limit 1);

insert into public.workspace_members (workspace_id, user_id, joined_at)
select workspace_id, id, created_at from public.profiles
on conflict do nothing;

do $$
declare r record; ws uuid;
begin
  for r in
    select m.user_id from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
    where w.kind = 'shared'
  loop
    if not exists (
      select 1 from public.workspace_members m2 join public.workspaces w2 on w2.id = m2.workspace_id
      where m2.user_id = r.user_id and w2.kind = 'personal'
    ) then
      insert into public.workspaces (kind, created_by) values ('personal', r.user_id) returning id into ws;
      insert into public.workspace_members (workspace_id, user_id) values (ws, r.user_id);
    end if;
  end loop;
end $$;
```

**Скрипт `migrate-v2.ts`** (Node, `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` из окружения; режимы `--dry-run` по умолчанию, `--apply`, `--verify`):
1. Для каждого `workspace_id` читает `drafts`, `overrides`, `parts`.
2. Собирает эффективные тайтлы **той же логикой, что клиент C**: in-memory `StorageLike` с ключами `backlog-added`, `backlog-overrides`, `backlog-parts` → `applyOverlay(getAdded(s), s)` из `app/src/lib/storage.ts`.
3. Для каждого тайтла строит строку `titles`:
   - `status` = эффективный (после производного);
   - `manual_status` = статус до производного (override → draft), только если у тайтла есть чеклист частей и он отличается от производного, иначе `null`;
   - `checked_parts` = `{ "<index>": parts.updated_at }` для отмеченных индексов;
   - `created_at` = `drafts.created_at` (важно для триггера B2), `source`/`source_id` из `drafts`;
   - `draft` и `rating` из overrides отбрасываются (`rating` из drafts переносится как есть).
4. `--dry-run` печатает по каждому пространству: число тайтлов, число с частями, число с `manual_status`, первые 5 строк.
5. `--apply` делает upsert партиями по 100.
6. `--verify` для каждого пространства сравнивает эффективные тайтлы (id, title, category, status, airingStatus, year, genres, cover, parts, отмеченные индексы) со строками `titles` и печатает все расхождения; код выхода 1, если они есть.

**Tests (Vitest):** на фикстуре (5 тайтлов: фильм, сериал с частями и ручным статусом под производным, аниме со всеми вышедшими частями, игра с override полей, тайтл с `rating`) функция `buildRows(drafts, overrides, parts)` даёт ожидаемые строки; `verifyRows` на них возвращает пустой список.

**Шаги-требования:** применить SQL досок → `--dry-run` → показать владельцу → `--apply` → `--verify` = 0 расхождений → владелец открывает v2 (ещё на старых таблицах) и новую выгрузку (`select … from titles`) и сверяет несколько тайтлов глазами.

---

### Task B5: Клиент на `titles`: производный статус при записи, активная доска

**Files:** Create `app/src/lib/derive.ts`, `app/src/lib/syncTitles.ts`, `app/src/data/boardsStore.ts`; Modify `titlesStore.ts`, `filters.ts`, `stats.ts`; Test `app/tests/lib/derive.test.ts`, `syncTitles.test.ts`, `app/tests/data/boardsStore.test.ts`.

**Interfaces:**
```ts
// derive.ts
export function materialize(t: { category: Category; parts?: Part[] | null; status: Status; manualStatus?: Status | null }, checked: number[]):
  { status: Status; manualStatus: Status | null; airingStatus: AiringStatus };
// syncTitles.ts — same guarantees as sync.ts (outbox before pull, first-run seed, echo suppression, busy deferral), one table
export function pullTitles(client, boardId): Promise<{ ok: boolean; rows: TitleRow[] }>;
export function pushTitlePatch(client, boardId, id, patch): Promise<boolean>;   // column-level upsert
export function pushTitleDelete(client, boardId, id): Promise<boolean>;
export function subscribeTitles(client, boardId, onChange): { unsubscribe(): void };
// boardsStore.ts
interface BoardsState { boards: Board[]; activeId: string | null; setActive(id: string): void; refresh(): Promise<void> }
```
`materialize`: если у тайтла есть чеклист (`hasPartsChecklist`) — `status = deriveStatus(parts, checked)`, `manualStatus` = прежний `manualStatus ?? status` до пересчёта, `airingStatus` по правилу `withDerivedStatus`; если чеклиста нет, а `manualStatus` есть — вернуть `status = manualStatus`, `manualStatus = null` (части удалили, ручной статус вернулся).

**Поведение:** зеркало `bl2:titles:<boardId>`, очередь `bl2:outbox:v2`; при первом запуске новой версии ключи `bl2:backlog-*` удаляются после успешного `pullTitles`; активная доска хранится в `bl2:board`; realtime подписка на `titles` с фильтром `workspace_id=eq.<boardId>`, переподписка при смене доски.

**Acceptance:** Vitest — 6 случаев `materialize` (нет частей; все не вышли; ничего не отмечено; частично; все вышедшие + есть невышедшие; все вышли и отмечены) + возврат ручного статуса; `syncTitles` проходит перенесённые сценарии `sync.test.ts` (очередь до чтения, первый запуск, эхо) на одной таблице.

**Релиз:** включается одним деплоем; до деплоя B4 `--verify` повторно = 0.

---

### Task B6: Приглашения в общую доску, выход, удаление участника, копирование

**Files:** Create `supabase/migrations/20261005000400_board_invites.sql`, `supabase/tests/board_invites.sql`; Modify `auth.ts` (или новый `app/src/lib/boards.ts`).

```sql
create table if not exists public.board_invites (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_user, to_user)
);
alter table public.board_invites enable row level security;
create policy "see own board invites" on public.board_invites for select using (to_user = auth.uid() or from_user = auth.uid());

create or replace function public.find_user_by_nick(p_nickname text) returns table (id uuid, name text, nickname text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(p.display_name, split_part(p.email, '@', 1)), p.nickname::text
  from profiles p where p.nickname = lower(p_nickname) and p.findable_by_nick and p.id <> auth.uid();
$$;

create or replace function public.invite_to_shared_board(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mine uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select m.workspace_id into mine from workspace_members m join workspaces w on w.id = m.workspace_id
    where m.user_id = auth.uid() and w.kind = 'shared';
  if exists (select 1 from workspace_members m join workspaces w on w.id = m.workspace_id
             where m.user_id = p_user and w.kind = 'shared' and w.id is distinct from mine) then
    raise exception 'target_has_shared' using errcode = 'P0001';
  end if;
  if mine is not null and exists (select 1 from workspace_members where workspace_id = mine and user_id = p_user) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  insert into board_invites (workspace_id, from_user, to_user) values (mine, auth.uid(), p_user)
  on conflict (from_user, to_user) do update set workspace_id = excluded.workspace_id, created_at = now();
end $$;

create or replace function public.my_board_invites() returns table (id bigint, from_id uuid, from_name text, from_nickname text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.id, p.id, coalesce(p.display_name, split_part(p.email, '@', 1)), p.nickname::text, i.created_at
  from board_invites i join profiles p on p.id = i.from_user where i.to_user = auth.uid() order by i.created_at desc;
$$;

create or replace function public.respond_board_invite(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare inv board_invites; ws uuid;
begin
  select * into inv from board_invites where id = p_id and to_user = auth.uid();
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  delete from board_invites where id = p_id;
  if not p_accept then return; end if;
  ws := inv.workspace_id;
  if ws is null then
    select m.workspace_id into ws from workspace_members m join workspaces w on w.id = m.workspace_id
      where m.user_id = inv.from_user and w.kind = 'shared';
    if ws is null then
      insert into workspaces (kind, created_by) values ('shared', inv.from_user) returning id into ws;
      insert into workspace_members (workspace_id, user_id) values (ws, inv.from_user);
    end if;
  end if;
  insert into workspace_members (workspace_id, user_id) values (ws, auth.uid());
end $$;

create or replace function public.leave_shared_board() returns void
language sql security definer set search_path = public as $$
  delete from workspace_members m using workspaces w
  where m.workspace_id = w.id and w.kind = 'shared' and m.user_id = auth.uid();
$$;

create or replace function public.remove_board_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ws uuid;
begin
  select m.workspace_id into ws from workspace_members m join workspaces w on w.id = m.workspace_id
    where m.user_id = auth.uid() and w.kind = 'shared';
  if ws is null then raise exception 'no_shared_board' using errcode = 'P0001'; end if;
  delete from workspace_members where workspace_id = ws and user_id = p_user and p_user <> auth.uid();
end $$;

-- A copy is an independent record: metadata travels, progress does not.
create or replace function public.copy_title(p_title_id text, p_from uuid, p_to uuid) returns void
language plpgsql security definer set search_path = public as $$
declare src titles;
begin
  if not (is_member(p_from) and is_member(p_to)) then raise exception 'not_member' using errcode = 'P0001'; end if;
  select * into src from titles where workspace_id = p_from and id = p_title_id;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  if exists (select 1 from titles t where t.workspace_id = p_to and (t.id = src.id
      or (src.source is not null and t.source = src.source and t.source_id = src.source_id))) then
    raise exception 'duplicate' using errcode = 'P0001';
  end if;
  insert into titles (workspace_id, id, title, original_title, category, status, airing_status, year, genres, synopsis,
                      cover, season_info, platforms, parts, source, source_id)
  values (p_to, src.id, src.title, src.original_title, src.category,
          case when src.status = 'unreleased' then 'unreleased' else 'queue' end,
          src.airing_status, src.year, src.genres, src.synopsis, src.cover, src.season_info, src.platforms, src.parts,
          src.source, src.source_id);
end $$;
```

**Tests (SQL):** приглашение без моей общей доски → при принятии создаётся доска с двумя участниками; приглашение человека с другой общей доской → `target_has_shared`; отказ удаляет приглашение без членства; `remove_board_member` чужой доски → ничего не удаляет; `copy_title` дубля → `duplicate`; копия получает `status = 'queue'` и пустые `checked_parts`.

---

### Task B7: Экран ника и профиль с досками

**Files:** Create `app/src/screens/Onboarding/Onboarding.tsx`; Modify `data/session.ts` (состояние `'onboarding'`, вызов `completeSignup` при отсутствии профиля), `screens/Profile/Profile.tsx`; Test `app/tests/data/session.test.ts`, `app/e2e/onboarding.spec.ts`.

**Mockups:** `ACNickname.dc.html`, `ACProfile.dc.html`.

**Поведение:** после входа без профиля → `completeSignup()`: `not_invited` → экран «не приглашён», `created` → онбординг; профиль без ника → онбординг; ник проверяется `nicknameAvailable` с задержкой 400мс («Ник свободен» / «Ник занят» / «Только латиница, цифры и _, от 3 до 20»); «Продолжить» → `setProfile`. Профиль: блок «Доски» из `myBoards()` (см. спеку 6.7), «Участники» у общей доски (выйти / удалить, с подтверждением), «Создать общую доску» / «Пригласить в общую доску» → поиск по нику (`findUserByNick`, точное совпадение) → `inviteToSharedBoard`; входящие приглашения в доску — плашка в профиле «Даша зовёт в общую доску · Принять / ✕» (в D переезжает в «Друзья»); тема пишется и в `profiles.theme` (`setTheme`), и в `localStorage`.

**Acceptance:** Vitest — `resolveSessionState` с `'onboarding'`; e2e — новый пользователь проходит ник и попадает в пустую личную доску (`ACEmpty`).

---

### Task B8: Переключатель досок и «Копировать в …»

**Files:** Create `app/src/screens/Backlog/BoardSwitch.tsx`; Modify `BacklogHeader.tsx`, `TitleActions.tsx`, `DesktopToolbar.tsx`; Test `app/e2e/boards.spec.ts`.

**Mockups:** `ACGrid.dc.html` (переключатель «Моё / Общее» с аватарами), `ACDesktop.dc.html`, `ACSheet.dc.html` (кнопка копирования).

**Поведение:** переключатель виден, только если досок две; смена доски — плавное появление сетки (спека, дизайн-система §6), фильтры сохраняются; в панели тайтла «Копировать в Моё / в Общее» → `copyTitle`, `duplicate` → «Уже есть в …».

**Acceptance (e2e):** два набора тайтлов в заглушке, переключение меняет сетку и числа вкладок; копирование добавляет тайтл во вторую доску со статусом «В бэклоге».

---

### Task B9: Внешние ID для старых тайтлов

**Files:** Create `app/tools/backfill-sources.ts`, `docs/superpowers/notes/sources-review.md` (генерируется); Test `app/tests/tools/backfill-sources.test.ts`.

**Поведение:** для тайтлов без `source` ищет у провайдера категории (`enrich.ts`, те же ключи и прокси); нормализация названия (регистр, ё→е, знаки препинания, «:», «—»); автоматически записывает, если совпали нормализованное название (или оригинальное), год ±0 и кандидат один; иначе пишет строку в `sources-review.md`: `| id | название | год | кандидат 1 (id, название, год) | кандидат 2 | … | выбор: ____ |`. Повторный запуск с `--apply-review` читает выбор владельца. Лимит запросов: не больше 3 в секунду.

**Acceptance:** Vitest — нормализация и правило «однозначно» на фикстурах; ручной прогон на проде: отчёт числа автоматически записанных и отправленных на проверку.

---

### Task B10: Итоги с периодами

**Files:** Modify `app/src/data/stats.ts`, `screens/Stats/Stats.tsx`; Test `app/tests/data/stats.test.ts`.

**Поведение:** переключатель «Месяц / Год / Всё время» появляется; месяц и год считают `completed_at` (тайтлы) и даты в `checked_parts` (сезоны); «всё время» — все завершённые; сравнение «на N больше, чем в прошлом месяце».

---

### Task B11: Удаление старой схемы (не раньше чем через 7 дней после B5)

**Files:** Create `supabase/migrations/20261015000000_drop_legacy.sql`.

```sql
alter publication supabase_realtime drop table public.drafts, public.overrides, public.parts;
drop table public.overrides;
drop table public.parts;
drop table public.drafts;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.leave_workspace();
drop function if exists public.remove_member(uuid);
drop function if exists public.invite_email(text, boolean);
alter table public.profiles drop column workspace_id;
drop function if exists public.current_workspace_id();
```

Перед применением: повторная выгрузка старых таблиц в JSON (архив), `--verify` = 0, владелец подтвердил в канбане. После — удалить из `sync.ts`/`titlesStore.ts` код старой схемы и тесты, которые его покрывали.

## Self-Review

- Спека 7.1 — B1, B6; 7.2 — B2, B5; 7.3 (доски и профиль) — B3, B6; 7.5 (даты) — B2, B10; 7.6 — B1 (бэкап), B4, B9, B11; 6.1 (ник) — B7; 6.3 (копирование) — B8; 6.7 — B7; 8 — B1, B3, B6.
- Соцтаблицы и RPC приватности — в D. `complete_signup` в D получает параметр токена ссылки (пересоздание функции).
- Имена сверены с C: `titlesStore`, `filters`, `stats`, `TitleActions`, `BacklogHeader`, `DesktopToolbar`.
