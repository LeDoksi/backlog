// @ts-nocheck — ported verbatim from v1's node:test suite. The fixtures are
// deliberately partial or malformed to exercise the modules' defensive paths,
// so they are run, not type-checked.
import assert from 'node:assert/strict';
import * as Auth from '../../src/lib/auth';

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

test('signInWithGoogle passes redirectTo through when given', async () => {
  var seen = null;
  var client = fakeClient({
    auth: {
      signInWithOAuth: function (opts) { seen = opts; return Promise.resolve({ data: {}, error: null }); }
    }
  });
  await Auth.signInWithGoogle(client, 'https://example.com/backlog/');
  assert.deepEqual(seen, { provider: 'google', options: { redirectTo: 'https://example.com/backlog/' } });
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

test('hasProfile is true when the profiles query for this user returns a row', async () => {
  var client = fakeClient({
    from: function (table) {
      assert.equal(table, 'profiles');
      return {
        select: function () {
          return {
            eq: function (column, value) {
              assert.equal(column, 'id');
              assert.equal(value, 'u1');
              return {
                maybeSingle: function () {
                  return Promise.resolve({ data: { id: 'u1' }, error: null });
                }
              };
            }
          };
        }
      };
    }
  });
  assert.equal(await Auth.hasProfile(client, 'u1'), true);
});

test('hasProfile is false when the profiles query for this user returns no row', async () => {
  var client = fakeClient({
    from: function () {
      return { select: function () { return { eq: function () { return { maybeSingle: function () {
        return Promise.resolve({ data: null, error: null });
      } }; } }; } };
    }
  });
  assert.equal(await Auth.hasProfile(client, 'u1'), false);
});

test('hasProfile is false, never throws, with no client or no userId', async () => {
  assert.equal(await Auth.hasProfile(null, 'u1'), false);
  assert.equal(await Auth.hasProfile(fakeClient(), null), false);
});

test('hasProfile filters by the current user, not the whole workspace', async () => {
  // A workspace with 2+ members previously made this query multi-row and
  // broke maybeSingle() — this pins the .eq() filter down explicitly so
  // that regression can't come back silently.
  var seenColumn = null, seenValue = null;
  var client = fakeClient({
    from: function () {
      return {
        select: function () {
          return {
            eq: function (column, value) {
              seenColumn = column; seenValue = value;
              return { maybeSingle: function () { return Promise.resolve({ data: { id: 'u2' }, error: null }); } };
            }
          };
        }
      };
    }
  });
  await Auth.hasProfile(client, 'u2');
  assert.equal(seenColumn, 'id');
  assert.equal(seenValue, 'u2');
});

test('inviteEmail without a client resolves to an error, never throws', async () => {
  assert.equal((await Auth.inviteEmail(null, 'x@x.com')).error.message, 'no client');
});
