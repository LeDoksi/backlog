import { create, type StoreApi, type UseBoundStore } from 'zustand';
import * as Social from '../lib/social';
import type { SupabaseLike } from '../lib/types';
import type { FeedRow } from './feedFormat';
import { groupByKey } from './friendsOn';
import { getSupabase } from './supabase';

export interface SocialState {
  /** The Friends tab badge: new feed lines since the last visit plus waiting requests. */
  badge: number;
  feed: FeedRow[] | null;
  inbox: Social.Inbox | null;
  friends: Social.Friend[] | null;
  matches: Social.Match[] | null;
  /** Friends on the open board's titles, by title key. */
  friendsOn: Record<string, Social.FriendOn[]>;
  /** The last read failed; what is shown may be stale. */
  failed: boolean;
  refreshBadge(): Promise<void>;
  /** Opening the Friends tab: read everything, then count the feed as seen. */
  openFriends(): Promise<void>;
  loadInbox(): Promise<void>;
  loadFriends(): Promise<void>;
  loadMatches(): Promise<void>;
  /** The desktop column beside the board: feed and matches, the feed not counted as seen. */
  loadPeek(): Promise<void>;
  /** One request for a whole board's keys; the same set is not asked twice in a row. */
  loadFriendsOn(keys: string[]): Promise<void>;
  reset(): void;
}

export interface SocialDeps { client: () => SupabaseLike | null; tz: () => string }

const pendingOf = (inbox: Social.Inbox | null) => (inbox ? inbox.friend_requests.length + inbox.board_invites.length : 0);

export function createSocialStore(deps: SocialDeps): UseBoundStore<StoreApi<SocialState>> {
  let lastKeys = '';
  return create<SocialState>()((set, get) => ({
    badge: 0,
    feed: null,
    inbox: null,
    friends: null,
    matches: null,
    friendsOn: {},
    failed: false,

    async refreshBadge() {
      const n = await Social.badgeCount(deps.client());
      if (n !== null) set({ badge: n });
    },

    async openFriends() {
      const [feed, inbox, friends, matches] = await Promise.all([
        Social.feed(deps.client(), deps.tz()), Social.myInbox(deps.client()), Social.myFriends(deps.client()), Social.matches(deps.client())
      ]);
      set((st) => ({
        feed: feed ?? st.feed, inbox: inbox ?? st.inbox, friends: friends ?? st.friends, matches: matches ?? st.matches,
        failed: !feed || !inbox || !friends || !matches
      }));
      // Only a feed that was actually shown counts as seen.
      if (feed && await Social.markFeedSeen(deps.client())) set({ badge: pendingOf(get().inbox) });
    },

    async loadInbox() {
      const inbox = await Social.myInbox(deps.client());
      if (inbox) set({ inbox });
    },

    async loadFriends() {
      const friends = await Social.myFriends(deps.client());
      if (friends) set({ friends });
    },

    async loadMatches() {
      const matches = await Social.matches(deps.client());
      if (matches) set({ matches });
    },

    async loadPeek() {
      const [feed, matches] = await Promise.all([Social.feed(deps.client(), deps.tz()), Social.matches(deps.client())]);
      set((st) => ({ feed: feed ?? st.feed, matches: matches ?? st.matches }));
    },

    async loadFriendsOn(keys) {
      const sig = [...keys].sort().join('|');
      if (sig === lastKeys) return;
      lastKeys = sig;
      const rows = await Social.friendsOnTitles(deps.client(), keys);
      if (rows) set({ friendsOn: groupByKey(rows) });
      else lastKeys = '';
    },

    reset() { lastKeys = ''; set({ badge: 0, feed: null, inbox: null, friends: null, matches: null, friendsOn: {}, failed: false }); }
  }));
}

function localZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export const useSocial = createSocialStore({ client: getSupabase, tz: localZone });
