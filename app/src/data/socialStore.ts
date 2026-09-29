import { create, type StoreApi, type UseBoundStore } from 'zustand';
import * as Social from '../lib/social';
import type { SupabaseLike } from '../lib/types';
import type { FeedRow } from './feedFormat';
import { getSupabase } from './supabase';

export interface SocialState {
  /** The Friends tab badge: new feed lines since the last visit plus waiting requests. */
  badge: number;
  feed: FeedRow[] | null;
  inbox: Social.Inbox | null;
  friends: Social.Friend[] | null;
  /** The last read failed; what is shown may be stale. */
  failed: boolean;
  refreshBadge(): Promise<void>;
  /** Opening the Friends tab: read everything, then count the feed as seen. */
  openFriends(): Promise<void>;
  loadInbox(): Promise<void>;
  loadFriends(): Promise<void>;
  reset(): void;
}

export interface SocialDeps { client: () => SupabaseLike | null; tz: () => string }

const pendingOf = (inbox: Social.Inbox | null) => (inbox ? inbox.friend_requests.length + inbox.board_invites.length : 0);

export function createSocialStore(deps: SocialDeps): UseBoundStore<StoreApi<SocialState>> {
  return create<SocialState>()((set, get) => ({
    badge: 0,
    feed: null,
    inbox: null,
    friends: null,
    failed: false,

    async refreshBadge() {
      const n = await Social.badgeCount(deps.client());
      if (n !== null) set({ badge: n });
    },

    async openFriends() {
      const [feed, inbox, friends] = await Promise.all([
        Social.feed(deps.client(), deps.tz()), Social.myInbox(deps.client()), Social.myFriends(deps.client())
      ]);
      set((st) => ({
        feed: feed ?? st.feed, inbox: inbox ?? st.inbox, friends: friends ?? st.friends,
        failed: !feed || !inbox || !friends
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

    reset() { set({ badge: 0, feed: null, inbox: null, friends: null, failed: false }); }
  }));
}

function localZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}

export const useSocial = createSocialStore({ client: getSupabase, tz: localZone });
