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
    const f = fake({ feed: [], my_inbox: inbox, my_friends: [], badge_count: 9 });
    f.store.setState({ badge: 9 });
    await f.store.getState().openFriends();
    expect(f.calls.slice(0, 3).sort()).toEqual(['feed', 'my_friends', 'my_inbox']);
    expect(f.calls[3]).toBe('mark_feed_seen');
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
});
