# D. Социальщина — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Перед стартом:** подпроект B завершён (есть `titles`, доски, профили с ником). Запустить `superpowers:writing-plans` для D и развернуть задачи в шаги по 2–5 минут. SQL ниже — целевой; каждая функция сначала покрывается pgTAP-тестом, потом применяется.

**Goal:** Друзья (взаимные), ссылка-приглашение и поиск по нику, приватность (три уровня на доску, скрытие тайтла, переключатели участия), лента с склейкой, совпадения, профиль друга с совпадением вкусов, глобальный лидерборд (BL-21).

**Architecture:** Соцтаблицы без прямого доступа клиента (RLS без политик чтения там, где данные чужие). Всё соцчтение — функции `security definer`, построенные на одном помощнике `visible_titles(owner)`, который и есть единственное место проверки приватности. События ленты пишет триггер на `titles`.

**Tech Stack:** Postgres 17, `pg_cron`, pgTAP; клиент как в C.

**Spec:** разделы 2 (решения 31–38, 49–56), 6.2 (мини-аватар), 6.3 («У друзей», «Скрыть»), 6.7–6.10, 7.1 (соцтаблицы), 7.3, 7.4, 7.5, 8.

## Global Constraints

Все пункты [индекса](2026-09-25-redesign-social-plan.md#global-constraints), плюс:
- По умолчанию всё приватно: `workspaces.visibility = 'private'`, `in_leaderboard = false`. Ни одна миграция не меняет эти значения у существующих пользователей.
- Email не возвращается ни одной функцией D. Имя: `coalesce(display_name, nickname, 'Без имени')`.
- Собственные скрытые тайтлы видны владельцу и участникам его доски, никому больше.
- Функции, которые не нашли прав, возвращают пусто, а не ошибку (не выдаём факт существования).
- Бейдж — единственное уведомление (решение 38).

## Review Focus

1. Приватная доска друга не появляется нигде: лента, полка, совпадения, совпадение вкусов, «У друзей», мини-аватары. Тест: `privacy_matrix.sql` (D10) — матрица «видимость × дружба × hidden × share_*» по каждой функции.
2. Переключение доски из `private` в `friends` не открывает прошлые события: события на приватной доске не пишутся вовсе. Тест: `activity.sql`.
3. Ссылка-приглашение: истёкшая не пускает в приложение; повторное использование многоразовой ссылки не создаёт дублей заявок. Тест: `invites.sql`.
4. Встречная заявка (А зовёт Б, пока Б зовёт А) сразу превращается в дружбу, без двух висящих заявок. Тест: `friends.sql`.
5. Лидерборд не считает скрытые тайтлы и дубль «личная + общая» дважды. Тест: `leaderboard.sql`.

---

### Task D1: Соцтаблицы, помощники видимости, хранение событий

**Files:** Create `supabase/migrations/20261020000000_social_core.sql`, `supabase/tests/visibility.sql`.

```sql
create table public.friendships (
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create table public.friend_requests (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (from_user, to_user),
  check (from_user <> to_user)
);
create table public.invite_links (
  token text primary key,
  created_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.activity_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title_id text not null,
  kind text not null check (kind in ('added', 'started', 'completed', 'parts')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_events_actor_time_idx on public.activity_events (actor_id, created_at desc);

alter table public.friendships enable row level security;
alter table public.friend_requests enable row level security;
alter table public.invite_links enable row level security;
alter table public.activity_events enable row level security;
create policy "see my friendships" on public.friendships for select using (auth.uid() in (user_a, user_b));
create policy "see my requests" on public.friend_requests for select using (auth.uid() in (from_user, to_user));
-- invite_links and activity_events: no policies, RPC only.

create or replace function public.are_friends(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from friendships where user_a = least(a, b) and user_b = greatest(a, b));
$$;

create or replace function public.title_key(p_source text, p_source_id text, p_id text) returns text
language sql immutable as $$
  select coalesce(p_source || ':' || p_source_id, 'slug:' || p_id);
$$;

-- The one place privacy is decided. Everything social reads through this.
create or replace function public.visible_titles(p_owner uuid) returns setof public.titles
language sql stable security definer set search_path = public as $$
  select distinct on (title_key(t.source, t.source_id, t.id)) t.*
  from titles t
  join workspace_members m on m.workspace_id = t.workspace_id and m.user_id = p_owner
  join workspaces w on w.id = t.workspace_id
  where
    (p_owner = auth.uid() or is_member(t.workspace_id))
    or (not t.hidden and (w.visibility = 'everyone' or (w.visibility = 'friends' and are_friends(p_owner, auth.uid()))))
  order by title_key(t.source, t.source_id, t.id), (w.kind = 'shared');
$$;

create or replace function public.display_name_of(p profiles) returns text
language sql immutable as $$
  select coalesce(nullif(p.display_name, ''), p.nickname::text, 'Без имени');
$$;

create extension if not exists pg_cron;
select cron.schedule('bl-activity-retention', '17 3 * * *',
  $$delete from public.activity_events where created_at < now() - interval '90 days'$$);
```

(Если `create extension pg_cron` недоступен миграцией, включить в дашборде Supabase → Database → Extensions и повторить.)

**Tests (`visibility.sql`):** матрица для `visible_titles(owner)` от лица зрителя: владелец видит всё, включая скрытое; участник общей доски видит всё в ней; друг видит `friends` и `everyone` без скрытого; не друг видит только `everyone` без скрытого; `private` не видит никто, кроме владельца и участников; дубль по ключу в личной и общей доске возвращается один раз.

---

### Task D2: Регистрация по ссылке, ссылки, поиск, друзья

**Files:** Create `supabase/migrations/20261020000100_friends.sql`, `supabase/tests/invites.sql`, `supabase/tests/friends.sql`; Create `app/src/lib/social.ts` + `app/tests/lib/social.test.ts`.

```sql
drop function if exists public.complete_signup();

create or replace function public.complete_signup(invite_token text default null) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  em text;
  full_name text;
  allowed record;
  inviter uuid;
  ws uuid;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  if exists (select 1 from profiles where id = uid) then
    if invite_token is not null then perform redeem_invite(invite_token); end if;
    return json_build_object('status', 'exists');
  end if;
  select u.email, u.raw_user_meta_data->>'full_name' into em, full_name from auth.users u where u.id = uid;
  select * into allowed from allowed_emails a where lower(a.email) = lower(em);
  if invite_token is not null then
    select created_by into inviter from invite_links where token = invite_token and expires_at > now();
  end if;
  if allowed is null and inviter is null then return json_build_object('status', 'not_invited'); end if;
  insert into workspaces (kind, created_by) values ('personal', uid) returning id into ws;
  insert into profiles (id, email, display_name) values (uid, em, full_name);
  insert into workspace_members (workspace_id, user_id) values (ws, uid);
  if allowed is not null and allowed.workspace_id is not null then
    insert into board_invites (workspace_id, from_user, to_user)
    values (allowed.workspace_id, coalesce(allowed.invited_by, uid), uid) on conflict (from_user, to_user) do nothing;
  end if;
  if inviter is not null and inviter <> uid then
    insert into friend_requests (from_user, to_user) values (inviter, uid) on conflict (from_user, to_user) do nothing;
  end if;
  return json_build_object('status', 'created');
end $$;

create or replace function public.create_invite_link() returns text
language plpgsql security definer set search_path = public as $$
declare tok text;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select token into tok from invite_links where created_by = auth.uid() and expires_at > now() + interval '1 day' order by created_at desc limit 1;
  if tok is not null then return tok; end if;
  tok := substr(translate(encode(gen_random_bytes(12), 'base64'), '+/=', ''), 1, 10);
  tok := lower(tok);
  insert into invite_links (token, created_by, expires_at) values (tok, auth.uid(), now() + interval '7 days');
  return tok;
end $$;

create or replace function public.redeem_invite(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare inviter uuid;
begin
  select created_by into inviter from invite_links where token = p_token and expires_at > now();
  if inviter is null then return json_build_object('status', 'expired'); end if;
  if inviter = auth.uid() then return json_build_object('status', 'self'); end if;
  if are_friends(inviter, auth.uid()) then return json_build_object('status', 'already_friends'); end if;
  insert into friend_requests (from_user, to_user) values (inviter, auth.uid()) on conflict (from_user, to_user) do nothing;
  return json_build_object('status', 'requested');
end $$;

create or replace function public.search_users(p_prefix text) returns table (id uuid, name text, nickname text, is_friend boolean, requested boolean)
language sql stable security definer set search_path = public as $$
  select p.id, display_name_of(p), p.nickname::text, are_friends(p.id, auth.uid()),
         exists (select 1 from friend_requests r where r.from_user = auth.uid() and r.to_user = p.id)
  from profiles p
  where p.findable_by_nick and p.id <> auth.uid() and length(p_prefix) >= 2
    and starts_with(p.nickname::text, lower(p_prefix))
  order by p.nickname limit 10;
$$;

create or replace function public.send_friend_request(p_user uuid) returns json
language plpgsql security definer set search_path = public as $$
begin
  if p_user = auth.uid() then return json_build_object('status', 'self'); end if;
  if are_friends(p_user, auth.uid()) then return json_build_object('status', 'already_friends'); end if;
  if exists (select 1 from friend_requests where from_user = p_user and to_user = auth.uid()) then
    insert into friendships (user_a, user_b) values (least(p_user, auth.uid()), greatest(p_user, auth.uid())) on conflict do nothing;
    delete from friend_requests where (from_user, to_user) in ((p_user, auth.uid()), (auth.uid(), p_user));
    return json_build_object('status', 'friends');
  end if;
  insert into friend_requests (from_user, to_user) values (auth.uid(), p_user) on conflict (from_user, to_user) do nothing;
  return json_build_object('status', 'requested');
end $$;

create or replace function public.respond_friend_request(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r friend_requests;
begin
  select * into r from friend_requests where id = p_id and to_user = auth.uid();
  if not found then return; end if;
  delete from friend_requests where id = p_id;
  if p_accept then
    insert into friendships (user_a, user_b) values (least(r.from_user, r.to_user), greatest(r.from_user, r.to_user)) on conflict do nothing;
  end if;
end $$;

create or replace function public.remove_friend(p_user uuid) returns void
language sql security definer set search_path = public as $$
  delete from friendships where user_a = least(p_user, auth.uid()) and user_b = greatest(p_user, auth.uid());
$$;

create or replace function public.my_inbox() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'friend_requests', coalesce((select json_agg(json_build_object('id', r.id, 'user_id', p.id, 'name', display_name_of(p), 'nickname', p.nickname, 'at', r.created_at) order by r.created_at desc)
      from friend_requests r join profiles p on p.id = r.from_user where r.to_user = auth.uid()), '[]'::json),
    'board_invites', coalesce((select json_agg(json_build_object('id', i.id, 'user_id', p.id, 'name', display_name_of(p), 'nickname', p.nickname, 'at', i.created_at) order by i.created_at desc)
      from board_invites i join profiles p on p.id = i.from_user where i.to_user = auth.uid()), '[]'::json)
  );
$$;

create or replace function public.my_friends() returns table (id uuid, name text, nickname text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, display_name_of(p), p.nickname::text, f.created_at
  from friendships f join profiles p on p.id = case when f.user_a = auth.uid() then f.user_b else f.user_a end
  where auth.uid() in (f.user_a, f.user_b)
  order by display_name_of(p);
$$;
```

`social.ts`: обёртки `completeSignup(client, token?)`, `createInviteLink`, `redeemInvite`, `searchUsers`, `sendFriendRequest`, `respondFriendRequest`, `removeFriend`, `myInbox`, `myFriends` — `guarded`-паттерн, как в `auth.ts`.

**Tests:** истёкшая ссылка → `not_invited` для нового и `expired` для существующего; новый по ссылке → профиль + заявка от владельца ссылки; повторный переход по той же ссылке не создаёт второй заявки; встречная заявка → дружба и обе заявки удалены; `search_users` не находит `findable_by_nick = false` и не возвращает email; строка короче 2 символов → пусто.

---

### Task D3: Приватность: видимость досок, скрытие тайтлов, переключатели

**Files:** Create `supabase/migrations/20261020000200_privacy.sql`; Create `app/src/screens/Privacy/Privacy.tsx`, `HiddenTitles.tsx`; Modify `TitleActions.tsx` («Скрыть от друзей / Показать друзьям»), `Profile.tsx` (строки «Приватность», «Скрытые тайтлы»); Test `app/e2e/privacy.spec.ts`.

**Mockups:** `ACPrivacy.dc.html`, `ACProfile.dc.html`, `ACSheet.dc.html`.

```sql
create or replace function public.set_board_visibility(p_workspace uuid, p_visibility text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_workspace) then raise exception 'not_member' using errcode = 'P0001'; end if;
  if p_visibility not in ('private', 'friends', 'everyone') then raise exception 'bad_visibility' using errcode = 'P0001'; end if;
  update workspaces set visibility = p_visibility where id = p_workspace;
end $$;

create or replace function public.set_privacy(p_in_leaderboard boolean, p_share_activity boolean, p_share_matches boolean, p_findable_by_nick boolean) returns void
language sql security definer set search_path = public as $$
  update profiles set in_leaderboard = p_in_leaderboard, share_activity = p_share_activity,
    share_matches = p_share_matches, findable_by_nick = p_findable_by_nick
  where id = auth.uid();
$$;
```

`hidden` у тайтла меняется обычным патчем `titles` (RLS участника), отдельная функция не нужна.

**Поведение:** экран по спеке 6.9; «Скрытые тайтлы» — список с «Показать»; у тайтла в скрытом состоянии в панели плашка «Скрыт от друзей».

**Acceptance (e2e со заглушкой RPC):** смена уровня вызывает `set_board_visibility` с правильными аргументами; переключатели вызывают `set_privacy` с полным набором значений; «Скрыть от друзей» пишет `hidden: true`.

---

### Task D4: События и лента

**Files:** Create `supabase/migrations/20261020000300_activity_feed.sql`, `supabase/tests/activity.sql`, `supabase/tests/feed.sql`; Create `app/src/screens/Friends/Friends.tsx`, `FeedList.tsx`, `FeedItem.tsx`, `app/src/data/socialStore.ts`; Modify `App.tsx` (секция `friends` в `SECTIONS`, бейдж); Test `app/tests/data/feedFormat.test.ts`, `app/e2e/feed.spec.ts`.

**Mockups:** `ACFriends.dc.html`, `ACFriendsDesktop.dc.html`, `ACFriendsDark.dc.html`.

```sql
create or replace function public.titles_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := coalesce(auth.uid(), new.created_by);
  vis text;
  k text;
  fresh int;
begin
  if actor is null or new.hidden then return new; end if;
  select visibility into vis from workspaces where id = new.workspace_id;
  -- Events on a private board are never written, so opening a board later
  -- cannot surface what happened while it was private.
  if vis = 'private' then return new; end if;
  if tg_op = 'INSERT' then
    if new.created_at < now() - interval '1 minute' then return new; end if;
    insert into activity_events (actor_id, workspace_id, title_id, kind) values (actor, new.workspace_id, new.id, 'added');
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'done' then k := 'completed';
    elsif new.status = 'in_progress' and old.status in ('queue', 'unreleased') then k := 'started';
    end if;
    if k is not null then
      insert into activity_events (actor_id, workspace_id, title_id, kind) values (actor, new.workspace_id, new.id, k);
    end if;
  end if;
  select count(*) into fresh from jsonb_object_keys(new.checked_parts) as key where not (old.checked_parts ? key);
  if fresh > 0 then
    insert into activity_events (actor_id, workspace_id, title_id, kind, payload)
    values (actor, new.workspace_id, new.id, 'parts', jsonb_build_object('count', fresh));
  end if;
  return new;
end $$;
create trigger titles_activity after insert or update on public.titles
  for each row execute function public.titles_activity();

create or replace function public.feed(p_before timestamptz default now(), p_limit int default 60)
returns table (actor_id uuid, actor_name text, kind text, title_id text, workspace_id uuid, title text, cover text,
               count int, covers json, at timestamptz, on_shared_board boolean)
language sql stable security definer set search_path = public as $$
with visible as (
  select e.id, e.actor_id, e.workspace_id, e.title_id, e.kind, e.payload, e.created_at,
         t.title as t_title, t.cover as t_cover, w.kind as w_kind
  from activity_events e
  join profiles p on p.id = e.actor_id and p.share_activity
  join workspaces w on w.id = e.workspace_id
  join titles t on t.workspace_id = e.workspace_id and t.id = e.title_id and not t.hidden
  where e.created_at < p_before and e.created_at > now() - interval '14 days'
    and e.actor_id <> auth.uid()
    and ((w.visibility <> 'private' and are_friends(e.actor_id, auth.uid())) or is_member(e.workspace_id))
),
singles as (
  select v.actor_id, v.kind, v.title_id, v.workspace_id, v.t_title, v.t_cover, 1 as cnt, null::json as covers, v.created_at as at, v.w_kind
  from visible v where v.kind in ('started', 'completed')
),
parts_day as (
  select v.actor_id, 'parts'::text as kind, v.title_id, v.workspace_id, max(v.t_title) as t_title, max(v.t_cover) as t_cover,
         sum((v.payload->>'count')::int)::int as cnt, null::json as covers, max(v.created_at) as at, max(v.w_kind) as w_kind
  from visible v
  where v.kind = 'parts' and not exists (
    select 1 from visible c where c.kind = 'completed' and c.actor_id = v.actor_id and c.title_id = v.title_id
      and date_trunc('day', c.created_at) = date_trunc('day', v.created_at))
  group by v.actor_id, v.title_id, v.workspace_id, date_trunc('day', v.created_at)
),
added_hour as (
  select v.actor_id, 'added'::text as kind, (array_agg(v.title_id order by v.created_at desc))[1] as title_id,
         (array_agg(v.workspace_id order by v.created_at desc))[1] as workspace_id,
         (array_agg(v.t_title order by v.created_at desc))[1] as t_title, (array_agg(v.t_cover order by v.created_at desc))[1] as t_cover,
         count(*)::int as cnt, json_agg(v.t_cover order by v.created_at desc) filter (where v.t_cover is not null) as covers,
         max(v.created_at) as at, max(v.w_kind) as w_kind
  from visible v where v.kind = 'added'
  group by v.actor_id, date_trunc('hour', v.created_at)
),
lines as (select * from singles union all select * from parts_day union all select * from added_hour)
select l.actor_id, display_name_of(p), l.kind, l.title_id, l.workspace_id, l.t_title, l.t_cover, l.cnt, l.covers, l.at, l.w_kind = 'shared'
from lines l join profiles p on p.id = l.actor_id
order by l.at desc
limit least(p_limit, 200);
$$;

create or replace function public.mark_feed_seen() returns void
language sql security definer set search_path = public as $$
  update profiles set feed_seen_at = now() where id = auth.uid();
$$;

create or replace function public.badge_count() returns int
language sql stable security definer set search_path = public as $$
  select (select count(*) from feed(now(), 200) f where f.at > coalesce((select feed_seen_at from profiles where id = auth.uid()), '-infinity'))::int
       + (select count(*) from friend_requests where to_user = auth.uid())::int
       + (select count(*) from board_invites where to_user = auth.uid())::int;
$$;
```

(Профиль актёра в `visible` нужен только для фильтра `share_activity`; имя берётся в финальном `select`.)

**Клиент:** `feedLines(rows)` превращает строки в текст. Род глагола по имени не угадываем (в макетах «посмотрела / добавил» — это пример), поэтому формулировки без рода: `completed` → «Лёша · завершено «Драйв»», `started` → «Вадим · начато «Тед Лассо»», `parts` → «Даша · 2 сезона «Фрирен»» (склонение «сезон / сезона / сезонов»), `added` → «Вадим · +12 тайтлов» с полоской обложек. **До реализации D4 показать владельцу эти формулировки** (открытый вопрос, см. Self-Review). Группы «Сегодня / На этой неделе / Раньше»; открытие вкладки «Друзья» вызывает `mark_feed_seen`; бейдж из `badge_count` при старте и по realtime-событиям заявок.

**Tests:** события не пишутся на приватной доске и для скрытого тайтла; перенос с прошлой датой не пишет `added`; `feed` склеивает 3 отметки частей за день в одну строку с `count = 3`, а в день завершения оставляет только `completed`; 12 добавлений за час → одна строка `added` с 12 и обложками; не друг не видит события `friends`-доски.

---

### Task D5: Заявки, «Добавить друга», переход по ссылке

**Files:** Create `app/src/screens/Friends/Requests.tsx`, `AddFriendSheet.tsx`, `app/src/data/inviteLink.ts`; Modify `data/session.ts` (сохранение `#f/<token>` до входа, передача в `completeSignup`); Test `app/tests/data/inviteLink.test.ts`, `app/e2e/add-friend.spec.ts`.

**Mockups:** `ACFriends.dc.html` (заявка сверху), `ACAddFriend.dc.html`.

**Поведение:** заявки в друзья и в общую доску сверху ленты («Принять / ✕»), приглашения в доску из профиля (B7) переезжают сюда; «Добавить» → панель: «Твоя ссылка» (`createInviteLink`, адрес `${origin}${BASE_URL}#f/<token>`, «Копировать», «Поделиться» через `navigator.share`, если есть), поиск по нику от 2 символов с задержкой 300мс, у результата «Добавить» / «Заявка отправлена» / «В друзьях»; переход по ссылке: токен из `location.hash` сохраняется в `bl2:invite` и удаляется из адреса, после входа — `completeSignup(token)` или `redeemInvite(token)`, итог показывается тостом («Заявка от Георгия ждёт в Друзьях»).

**Acceptance:** Vitest — разбор `#f/abc123xyz0`, игнор мусора; e2e — поиск «kat» показывает Катю, «Добавить» меняет кнопку на «Заявка отправлена».

---

### Task D6: Полка друга и совпадение вкусов

**Files:** Create `supabase/migrations/20261020000400_shelf_taste.sql`, `supabase/tests/taste.sql`; Create `app/src/screens/FriendProfile/FriendProfile.tsx`, `TasteCard.tsx`; Test `app/e2e/friend-profile.spec.ts`.

**Mockups:** `ACFriendProfile.dc.html`.

```sql
create or replace function public.friend_shelf(p_user uuid, p_status text) returns table (id text, title text, category text, year int, cover text, common boolean)
language sql stable security definer set search_path = public as $$
  with mine as (select title_key(source, source_id, id) k from visible_titles(auth.uid()))
  select t.id, t.title, t.category, t.year, t.cover, title_key(t.source, t.source_id, t.id) in (select k from mine)
  from visible_titles(p_user) t
  where p_user <> auth.uid() and t.status = case p_status when 'watching' then 'in_progress' when 'want' then 'queue' else 'done' end
  order by t.updated_at desc;
$$;

create or replace function public.taste_match(p_user uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  d1 text[]; d2 text[]; w1 text[]; w2 text[]; n1 int; n2 int;
  common int; both_want int; t numeric := 0; g numeric := 0; w numeric := 0; top text[];
begin
  if not coalesce((select share_matches from profiles where id = p_user), false)
     or not coalesce((select share_matches from profiles where id = auth.uid()), false) then
    return json_build_object('status', 'disabled');
  end if;
  select coalesce(array_agg(title_key(source, source_id, id)) filter (where status = 'done'), '{}'),
         coalesce(array_agg(title_key(source, source_id, id)) filter (where status = 'queue'), '{}'), count(*)
    into d1, w1, n1 from visible_titles(auth.uid());
  select coalesce(array_agg(title_key(source, source_id, id)) filter (where status = 'done'), '{}'),
         coalesce(array_agg(title_key(source, source_id, id)) filter (where status = 'queue'), '{}'), count(*)
    into d2, w2, n2 from visible_titles(p_user);
  if n1 < 5 or n2 < 5 then return json_build_object('status', 'not_enough'); end if;

  common := cardinality(array(select unnest(d1) intersect select unnest(d2)));
  if cardinality(d1) > 0 and cardinality(d2) > 0 then
    t := common / sqrt(cardinality(d1)::numeric * cardinality(d2));
  end if;

  with a as (select gg, count(*)::numeric c from visible_titles(auth.uid()) x, jsonb_array_elements_text(x.genres) gg where x.status in ('done', 'in_progress') group by gg),
       b as (select gg, count(*)::numeric c from visible_titles(p_user) x, jsonb_array_elements_text(x.genres) gg where x.status in ('done', 'in_progress') group by gg),
       na as (select sqrt(sum(c * c)) n from a), nb as (select sqrt(sum(c * c)) n from b)
  select coalesce(sum(a.c * b.c) / nullif((select n from na) * (select n from nb), 0), 0),
         (array_agg(a.gg order by least(a.c, b.c) desc))[1:3]
    into g, top
  from a join b using (gg);

  both_want := cardinality(array(select unnest(w1) intersect select unnest(w2)));
  w := least(1, (both_want
        + cardinality(array(select unnest(w1) intersect select unnest(d2)))
        + cardinality(array(select unnest(w2) intersect select unnest(d1))))::numeric
       / nullif(sqrt(cardinality(array(select unnest(w1) union select unnest(d1)))::numeric
                   * cardinality(array(select unnest(w2) union select unnest(d2)))), 0));

  return json_build_object('status', 'ok',
    'percent', round(100 * (0.6 * t + 0.3 * coalesce(g, 0) + 0.1 * coalesce(w, 0))),
    'common', common, 'both_want', both_want, 'genres', coalesce(to_json(top), '[]'::json));
end $$;
```

**Поведение:** экран по спеке 6.10; «⋯» → «Удалить из друзей» с подтверждением (`remove_friend`); `not_enough` → «Пока мало данных для сравнения»; `disabled` → карточка совпадения скрыта.

**Tests (`taste.sql`):** одинаковые полки → 100; непересекающиеся полки и жанры → 0; меньше 5 тайтлов → `not_enough`; выключенный `share_matches` у любого → `disabled`; скрытые тайтлы не участвуют.

---

### Task D7: Совпадения, «У друзей», мини-аватары, колонка на десктопе

**Files:** Create `supabase/migrations/20261020000500_matches.sql`, `supabase/tests/matches.sql`; Create `app/src/screens/Friends/Matches.tsx`, `app/src/screens/TitleSheet/FriendsOnTitle.tsx`, `app/src/screens/Backlog/FriendsColumn.tsx`; Modify `TitleCard.tsx`; Test `app/e2e/matches.spec.ts`.

**Mockups:** `ACFriends.dc.html`, `ACSheet.dc.html` («У друзей»), `ACGrid.dc.html` (мини-аватар), `ACDesktop.dc.html` (колонка).

```sql
create or replace function public.my_friend_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select case when user_a = auth.uid() then user_b else user_a end from friendships where auth.uid() in (user_a, user_b);
$$;

create or replace function public.matches() returns table (friend_id uuid, friend_name text, title_key text, title text, cover text, friend_status text)
language sql stable security definer set search_path = public as $$
  select f, display_name_of(p), title_key(m.source, m.source_id, m.id), m.title, m.cover, th.status
  from my_friend_ids() f
  join profiles p on p.id = f and p.share_matches
  cross join lateral visible_titles(f) th
  join visible_titles(auth.uid()) m on title_key(m.source, m.source_id, m.id) = title_key(th.source, th.source_id, th.id)
  where coalesce((select share_matches from profiles where id = auth.uid()), false)
    and m.status = 'queue' and th.status in ('queue', 'in_progress')
  order by th.updated_at desc
  limit 50;
$$;

create or replace function public.friends_on_titles(p_keys text[]) returns table (title_key text, friend_id uuid, friend_name text, status text)
language sql stable security definer set search_path = public as $$
  select title_key(th.source, th.source_id, th.id), f, display_name_of(p), th.status
  from my_friend_ids() f
  join profiles p on p.id = f
  cross join lateral visible_titles(f) th
  where title_key(th.source, th.source_id, th.id) = any (p_keys);
$$;
```

**Поведение:** вкладка «Совпадения» — строки «Вы с Вадимом оба хотите «Бэтмена»» / «Лёша тоже смотрит …»; в панели тайтла «У друзей» из `friends_on_titles([key])`, нажатие → профиль друга; в сетке один запрос `friends_on_titles(keys видимых карточек)` при смене доски или фильтра, мини-аватар первого друга (приоритет: смотрит → хочет → завершил); на десктопе от 1280px колонка «У друзей»: карточка совпадения + 4 последних события ленты.

**Tests (`matches.sql`):** совпадение только по ключу тайтла; нет совпадений с `private`-доской друга; выключенный `share_matches` у меня → пусто.

---

### Task D8: Лидерборд

**Files:** Create `supabase/migrations/20261020000600_leaderboard.sql`, `supabase/tests/leaderboard.sql`; Create `app/src/screens/Stats/Leaderboard.tsx`; Modify `Stats.tsx`; Test `app/e2e/leaderboard.spec.ts`.

**Mockups:** `ACStats.dc.html`, `ACStatsDesktop.dc.html`.

```sql
create or replace function public.leaderboard(p_category text, p_period text)
returns table (user_id uuid, name text, score int, place int, is_me boolean)
language sql stable security definer set search_path = public as $$
  with since as (
    select case p_period when 'month' then date_trunc('month', now()) when 'year' then date_trunc('year', now()) else '-infinity'::timestamptz end as ts
  ),
  people as (select p.id, display_name_of(p) as name from profiles p where p.in_leaderboard),
  own as (
    select pe.id as uid, t.* from people pe
    join workspace_members m on m.user_id = pe.id
    join titles t on t.workspace_id = m.workspace_id
    where t.category = p_category and not t.hidden
  ),
  whole as (
    select o.uid, count(distinct title_key(o.source, o.source_id, o.id)) as n
    from own o, since
    where o.status = 'done' and (p_period = 'all' or o.completed_at >= since.ts)
      and (p_category in ('movie', 'game') or o.parts is null or jsonb_array_length(o.parts) = 0)
    group by o.uid
  ),
  seasons as (
    select o.uid, count(distinct (title_key(o.source, o.source_id, o.id), cp.key)) as n
    from own o cross join lateral jsonb_each_text(o.checked_parts) cp, since
    where p_category in ('series', 'anime') and (p_period = 'all' or cp.value::timestamptz >= since.ts)
    group by o.uid
  ),
  scores as (
    select pe.id, pe.name, (coalesce(w.n, 0) + coalesce(s.n, 0))::int as score
    from people pe left join whole w on w.uid = pe.id left join seasons s on s.uid = pe.id
  )
  select id, name, score, (rank() over (order by score desc))::int, id = auth.uid()
  from scores where score > 0 or id = auth.uid()
  order by score desc, name
  limit 10;
$$;
```

(В лидерборд попадает только число: участник сам включил участие, поэтому число видно даже при приватных досках. Это оговорено в спеке 7.5 и подписано в интерфейсе приватности: «Показывать меня в «Лидерах» среди всех в Бэклоге».)

**Поведение:** секция по спеке 6.8; не участвую → плашка со ссылкой на приватность; моя строка подсвечена, если я не в топ-10 — отдельной строкой снизу («Ты: N»).

**Tests (`leaderboard.sql`):** тайтл в личной и общей доске засчитывается один раз; скрытый не считается; сезоны считаются по датам отметок; не участник не виден другим; «месяц» не считает завершённое в прошлом месяце.

---

### Task D9: Вкладка «Друзья» целиком и десктоп

**Files:** Modify `App.tsx`, `Friends.tsx`, `AppShell`; Create `app/src/screens/Friends/FriendsList.tsx`; Test `app/e2e/friends-desktop.spec.ts`, скриншоты в `visual.spec.ts`.

**Поведение:** вкладки «Лента / Совпадения N / Друзья N»; список друзей с процентом совпадения (по `taste_match` для каждого, кэш на сессию); десктоп по `ACFriendsDesktop.dc.html` (лента слева, справа заявки, друзья, совпадения); тёмная тема по `ACFriendsDark.dc.html`.

---

### Task D10: Аудит приватности и закрытие

**Files:** Create `supabase/tests/privacy_matrix.sql`; Modify `README.md` (раздел «Друзья и приватность»); Kanban: закрыть BL-21, BL-24 (если не закрыт в B), BL-27.

**Шаги-требования:**
1. `privacy_matrix.sql`: 4 пользователя (я, друг, не друг, участник моей общей доски) × видимость личной доски (`private`, `friends`, `everyone`) × `hidden` × `share_activity` × `share_matches` — для каждой соцфункции (`feed`, `friend_shelf`, `matches`, `friends_on_titles`, `taste_match`, `leaderboard`, `search_users`) ожидаемый результат в таблице внутри теста.
2. Проверка «ни одна функция не возвращает email»: `grep` по `supabase/migrations/2026102*.sql` на `email` в списках `select` — только в `complete_signup` (запись) и `my_boards` (B).
3. Ручной прогон с владельцем на двух аккаунтах (владелец и девушка): открыть доску друзьям, отметить сезон, увидеть событие у второго; скрыть тайтл — событие и полка его больше не показывают.
4. Скриншоты соцэкранов в обеих темах сверены с макетами.

## Self-Review

- Решения 31–38 и 49–56 покрыты: друзья и ссылки — D2, D5; приватность — D1, D3, D10; лента — D4; совпадения — D7; совпадение вкусов — D6 (без подсказки «из твоего хочу»); лидерборд — D8; удаление из друзей — D6; полка друга с тремя вкладками — D6; общая доска по нику — B6/B7, заявки переезжают во «Друзья» — D5.
- Открытый вопрос для владельца (D4): формулировки ленты без рода глагола — «Лёша · завершено «Драйв»», «Даша · 2 сезона «Фрирен»», «Вадим · +12 тайтлов». Род по имени не угадываем. Альтернатива: пользователь сам выбирает в профиле форму глаголов («завершил / завершила / нейтрально»). Спросить до реализации D4.
