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

  function signInWithGoogle(client) {
    if (!client) return Promise.resolve(noClientError());
    return Promise.resolve(client.auth.signInWithOAuth({ provider: 'google' }));
  }

  function signOut(client) {
    if (!client) return Promise.resolve({ error: null });
    return Promise.resolve(client.auth.signOut());
  }

  function getSession(client) {
    if (!client) return Promise.resolve({ data: { session: null }, error: null });
    return Promise.resolve(client.auth.getSession());
  }

  // Returns an unsubscribe-capable handle either way, so a caller can always
  // call `.unsubscribe()` on the result without a client-presence check.
  function onAuthStateChange(client, callback) {
    if (!client) return { unsubscribe: function () {} };
    var result = client.auth.onAuthStateChange(callback);
    return (result && result.data && result.data.subscription)
      ? result.data.subscription
      : { unsubscribe: function () {} };
  }

  function hasProfile(client) {
    if (!client) return Promise.resolve(false);
    return Promise.resolve(client.from('profiles').select('id').maybeSingle())
      .then(function (res) { return !!(res && res.data); })
      .catch(function () { return false; });
  }

  function listWorkspaceMembers(client) {
    if (!client) return Promise.resolve([]);
    return Promise.resolve(client.from('profiles').select('id, email'))
      .then(function (res) { return (res && Array.isArray(res.data)) ? res.data : []; })
      .catch(function () { return []; });
  }

  function inviteEmail(client, email, addToMyWorkspace) {
    if (!client) return Promise.resolve(noClientError());
    return Promise.resolve(client.rpc('invite_email', {
      target_email: email,
      add_to_my_workspace: !!addToMyWorkspace
    }));
  }

  function leaveWorkspace(client) {
    if (!client) return Promise.resolve(noClientError());
    return Promise.resolve(client.rpc('leave_workspace'));
  }

  function removeMember(client, userId) {
    if (!client) return Promise.resolve(noClientError());
    return Promise.resolve(client.rpc('remove_member', { target_user_id: userId }));
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
