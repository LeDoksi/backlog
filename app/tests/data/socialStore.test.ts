import { describe, expect, it } from 'vitest';
import { createSocialStore } from '../../src/data/socialStore';

function fake(replies: Record<string, unknown>, failing: string[] = []) {
  const calls: string[] = [];
  const client = {
    rpc(name: string) {
      calls.push(name);
      return Promise.resolve(failing.includes(name) ? { data: null, error: { message: 'offline' } } : { data: replies[name] ?? null, error: null });
    }
  };
  return { calls, store: createSocialStore({ client: () => client, tz: () => 'Europe/Moscow' }) };
}
const inbox = { friend_requests: [{ id: 1, user_id: 'u', name: 'К', nickname: 'k', at: 't' }], board_invites: [] };

describe('social store', () => {
  it('refreshBadge keeps the old number when the call fails', async () => {
    const ok = fake({ badge_count: 4 });
    await ok.store.getState().refreshBadge();
    expect(ok.store.getState().badge).toBe(4);
    const bad = fake({}, ['badge_count']);
    bad.store.setState({ badge: 2 });
    await bad.store.getState().refreshBadge();
    expect(bad.store.getState().badge).toBe(2);
  });

  it('opening Friends reads feed, inbox and friends, marks the feed seen, badge = waiting requests', async () => {
    const f = fake({ feed: [], my_inbox: inbox, my_friends: [], matches: [], badge_count: 9 });
    f.store.setState({ badge: 9 });
    await f.store.getState().openFriends();
    expect(f.calls.slice(0, 4).sort()).toEqual(['feed', 'matches', 'my_friends', 'my_inbox']);
    expect(f.calls[4]).toBe('mark_feed_seen');
    expect(f.store.getState().badge).toBe(1);
    expect(f.store.getState().failed).toBe(false);
  });

  it('a feed that did not load is not marked seen', async () => {
    const f = fake({ my_inbox: inbox, my_friends: [] }, ['feed']);
    f.store.setState({ badge: 5 });
    await f.store.getState().openFriends();
    expect(f.calls).not.toContain('mark_feed_seen');
    expect(f.store.getState().badge).toBe(5);
    expect(f.store.getState().failed).toBe(true);
  });

  it('friends on titles: one call per set of keys, grouped by key', async () => {
    const f = fake({ friends_on_titles: [{ title_key: 'k1', friend_id: 'a', friend_name: 'А', status: 'done' }] });
    await f.store.getState().loadFriendsOn(['k1', 'k2']);
    await f.store.getState().loadFriendsOn(['k2', 'k1']);
    expect(f.calls.filter((c) => c === 'friends_on_titles')).toHaveLength(1);
    expect(Object.keys(f.store.getState().friendsOn)).toEqual(['k1']);
  });

  it('the desktop column reads feed and matches without marking the feed seen', async () => {
    const f = fake({ feed: [{ kind: 'added' }], matches: [] });
    f.store.setState({ badge: 3 });
    await f.store.getState().loadPeek();
    expect(f.calls.sort()).toEqual(['feed', 'matches']);
    expect(f.store.getState().feed).toHaveLength(1);
    expect(f.store.getState().badge).toBe(3);
  });

  it('taste for the friends list: asked once per friend for the session, failures retried later', async () => {
    const f = fake({ taste_match: { status: 'ok', percent: 72, common: 5, both_want: 1, genres: [] } });
    await f.store.getState().loadTaste(['a', 'b']);
    await f.store.getState().loadTaste(['a', 'b']);
    expect(f.calls.filter((c) => c === 'taste_match')).toHaveLength(2);
    expect(f.store.getState().taste.a).toMatchObject({ status: 'ok', percent: 72 });
    const bad = fake({}, ['taste_match']);
    await bad.store.getState().loadTaste(['a']);
    await bad.store.getState().loadTaste(['a']);
    expect(bad.calls.filter((c) => c === 'taste_match')).toHaveLength(2);
    expect(bad.store.getState().taste.a).toBeUndefined();
  });
});
