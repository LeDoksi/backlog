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
