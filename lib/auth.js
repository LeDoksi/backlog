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

  function signInWithGoogle(client, redirectTo) {
    if (!client) return Promise.resolve(noClientError());
    return guarded(
      function () {
        var params = { provider: 'google' };
        if (redirectTo) params.options = { redirectTo: redirectTo };
        return client.auth.signInWithOAuth(params);
      },
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

  function hasProfile(client, userId) {
    if (!client || !userId) return Promise.resolve(false);
    return guarded(
      function () { return client.from('profiles').select('id').eq('id', userId).maybeSingle(); },
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
