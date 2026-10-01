// auth.ts
//
// Тонкая обёртка над Supabase Auth и тремя RPC-функциями пространств —
// тот же DI-паттерн, что lib/sync.js: клиент передаётся явно, ничего не
// читается из глобального window, ни одна функция не бросает (сеть/auth —
// всегда «может не получиться», это состояние, а не исключение).
import type { SupabaseLike } from './types';

// Supabase-style `{ data, error }`; never a rejection.
export interface Result<T = unknown> { data: T | null; error: { message?: string } | null }

function noClientError() {
  return { data: null, error: { message: 'no client' } };
}

// Resolves `run()`'s result no matter what, including a client that
// throws synchronously — same shape as lib/sync.js's selectAll/attempt:
// a `try` around the call itself, not just a `.catch` on its promise,
// since `client.from(...)`/`client.rpc(...)` can throw before ever
// returning a promise to chain onto.
function guarded(run: () => any, onError: (e: any) => any): Promise<any> {
  try {
    return Promise.resolve(run()).catch(function (e) { return onError(e); });
  } catch (e) {
    return Promise.resolve(onError(e));
  }
}

function signInWithGoogle(client: SupabaseLike, redirectTo?: string): Promise<Result> {
  if (!client) return Promise.resolve(noClientError());
  return guarded(
    function () {
      var params: { provider: string; options?: { redirectTo: string } } = { provider: 'google' };
      if (redirectTo) params.options = { redirectTo: redirectTo };
      return client.auth.signInWithOAuth(params);
    },
    function (e) { return { data: null, error: e || { message: 'unknown' } }; }
  );
}

function signOut(client: SupabaseLike): Promise<{ error: { message?: string } | null }> {
  if (!client) return Promise.resolve({ error: null });
  return guarded(
    function () { return client.auth.signOut(); },
    function (e) { return { error: e || { message: 'unknown' } }; }
  );
}

function getSession(client: SupabaseLike): Promise<Result<{ session: { user: { id: string; email?: string } } | null }>> {
  if (!client) return Promise.resolve({ data: { session: null }, error: null });
  return guarded(
    function () { return client.auth.getSession(); },
    function (e) { return { data: { session: null }, error: e || { message: 'unknown' } }; }
  );
}

// Returns an unsubscribe-capable handle either way, so a caller can always
// call `.unsubscribe()` on the result without a client-presence check.
function onAuthStateChange(client: SupabaseLike, callback: (event: string, session: unknown) => void): { unsubscribe(): void } {
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

function hasProfile(client: SupabaseLike, userId: string | null | undefined): Promise<boolean> {
  if (!client || !userId) return Promise.resolve(false);
  return guarded(
    function () { return client.from('profiles').select('id').eq('id', userId).maybeSingle(); },
    function () { return null; }
  ).then(function (res: any) { return !!(res && res.data); });
}

// ── Profile and boards (v2 schema) ─────────────────────────────────────
//
// Same contract as above: never throws, and "the call failed" is `null`,
// distinct from any answer the server can give, so a network blip is never
// read as "not invited" or "nickname taken".

export type Theme = 'system' | 'light' | 'dark';
export type SignupStatus = 'created' | 'exists' | 'not_invited';
export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  nickname: string | null;
  theme: Theme;
  in_leaderboard?: boolean;
  share_activity?: boolean;
  share_matches?: boolean;
  findable_by_nick?: boolean;
}
export interface BoardMember { id: string; name: string; nickname: string | null; email?: string }
export interface BoardRow { id: string; kind: 'personal' | 'shared'; visibility: string; title_count: number; members: BoardMember[] | null; in_leaderboard?: boolean }

function callRpc(client: SupabaseLike, name: string, args?: Record<string, unknown>): Promise<Result> {
  if (!client) return Promise.resolve(noClientError());
  return guarded(
    function () { return args === undefined ? client.rpc(name) : client.rpc(name, args); },
    function (e) { return { data: null, error: e || { message: 'unknown' } }; }
  ).then(function (res: any) { return res || { data: null, error: { message: 'empty response' } }; });
}

function completeSignup(client: SupabaseLike): Promise<SignupStatus | null> {
  return callRpc(client, 'complete_signup').then(function (res) {
    var status = !res.error && res.data ? (res.data as { status?: string }).status : null;
    return status === 'created' || status === 'exists' || status === 'not_invited' ? status : null;
  });
}

function nicknameAvailable(client: SupabaseLike, nickname: string): Promise<boolean | null> {
  return callRpc(client, 'nickname_available', { p_nickname: nickname }).then(function (res) {
    return !res.error && typeof res.data === 'boolean' ? res.data : null;
  });
}

function setProfile(client: SupabaseLike, displayName: string, nickname: string): Promise<{ ok: boolean; error: string | null }> {
  return callRpc(client, 'set_profile', { p_display_name: displayName, p_nickname: nickname }).then(function (res) {
    return res.error ? { ok: false, error: res.error.message || 'unknown' } : { ok: true, error: null };
  });
}

function setTheme(client: SupabaseLike, theme: Theme): Promise<boolean> {
  return callRpc(client, 'set_theme', { p_theme: theme }).then(function (res) { return !res.error; });
}

function myProfile(client: SupabaseLike): Promise<Profile | null> {
  return callRpc(client, 'my_profile').then(function (res) {
    return !res.error && res.data && typeof res.data === 'object' ? res.data as Profile : null;
  });
}

function myBoards(client: SupabaseLike): Promise<BoardRow[] | null> {
  return callRpc(client, 'my_boards').then(function (res) {
    return !res.error && Array.isArray(res.data) ? res.data as BoardRow[] : null;
  });
}

// Grants access to the app only; joining a board is a separate invite.
function inviteEmail(client: SupabaseLike, email: string): Promise<Result> {
  return callRpc(client, 'invite_email', { target_email: email });
}

export {
  callRpc,
  completeSignup,
  nicknameAvailable,
  setProfile,
  setTheme,
  myProfile,
  myBoards,
  signInWithGoogle,
  signOut,
  getSession,
  onAuthStateChange,
  hasProfile,
  inviteEmail
};
