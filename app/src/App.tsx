import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { LayoutGroup } from 'motion/react';
import { useSession } from './data/session';
import { useTitles, mirror, outbox } from './data/titlesStore';
import { useBoards } from './data/boardsStore';
import { startSync } from './data/syncEngine';
import { getSupabase } from './data/supabase';
import { useUi } from './data/ui';

// Search and its sources load on the first «+» (spec: 250 KB first load).
const QuickAdd = lazy(() => import('./screens/QuickAdd/QuickAdd').then((m) => ({ default: m.QuickAdd })));
import { SignIn } from './screens/SignIn';
import { NotInvited } from './screens/NotInvited';
import { Onboarding } from './screens/Onboarding/Onboarding';
import { Backlog } from './screens/Backlog/Backlog';
import { TitleSheet } from './screens/TitleSheet/TitleSheet';
import { EditTitle } from './screens/EditTitle/EditTitle';
import { Stats } from './screens/Stats/Stats';
import { Profile } from './screens/Profile/Profile';
import { Friends } from './screens/Friends/Friends';
import { FriendProfile } from './screens/FriendProfile/FriendProfile';
import { FriendTitle } from './screens/FriendTitle/FriendTitle';
import { FeedBatch } from './screens/FeedBatch/FeedBatch';
import { useSocial } from './data/socialStore';
import { clearMirror, flushQueue } from './data/mirror';
import { SyncStatus } from './ui/SyncStatus';
import { Toast } from './ui/Toast';
import { AppShell } from './ui/AppShell';
import type { Section } from './ui/TabBar';
import { Skeleton } from './ui/Skeleton';
import type { Profile as ProfileData } from './lib/auth';
import { hasUnreadWhatsNew } from './data/whatsNew';
import { useFilters } from './data/filters';
import { useOther } from './data/otherStore';

const SECTIONS: Section[] = ['backlog', 'friends', 'stats', 'profile'];
// The badge is the only notification (decision 38); it is re-read when the
// app comes back to the foreground and every few minutes while it is open.
const BADGE_EVERY_MS = 3 * 60 * 1000;

interface SignedProps { profile: ProfileData; onProfile(p: ProfileData): void; onSignOut(): void; onDeleted(): void }

function Signed({ profile, onProfile, onSignOut, onDeleted }: SignedProps) {
  const section = useUi((u) => u.section);
  const setSection = useUi((u) => u.setSection);
  const setQuickAdd = useUi((u) => u.setQuickAdd);
  // Mounted from the first open on, so closing it still animates.
  const quickAddSeen = useRef(false);
  const quickAddUsed = useUi((u) => u.quickAddOpen) || quickAddSeen.current;
  quickAddSeen.current = quickAddUsed;
  const showOther = !!profile.show_other;
  // «+» on the «Другое» tab writes a line by hand: there is no search there.
  const add = () => {
    if (showOther && useUi.getState().section === 'backlog' && useFilters.getState().category === 'other') useOther.getState().openForm({});
    else setQuickAdd(true);
  };

  // The background checks against the sources load after the first paint (spec: 250 KB first load).
  useEffect(() => startSync({ store: useTitles, storage: mirror, outbox, client: getSupabase,
    onPulled: (board) => { void import('./data/dailyRefresh').then((m) => m.refreshBoardDaily(board)).catch(() => {}); } }), []);
  useEffect(() => { void useBoards.getState().refresh(); }, []);
  const badge = useSocial((st) => st.badge);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void useSocial.getState().refreshBadge(); };
    refresh();
    const timer = window.setInterval(refresh, BADGE_EVERY_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh); useSocial.getState().reset(); };
  }, []);

  return (
    <LayoutGroup>
      <AppShell sections={SECTIONS} section={section} badge={badge} dot={hasUnreadWhatsNew(profile.whats_new_seen_at)} onNavigate={setSection} onAdd={add}>
        {section === 'backlog' && <Backlog showOther={showOther} />}
        {section === 'friends' && <Friends />}
        {section === 'stats' && <Stats />}
        {section === 'profile' && <Profile profile={profile} onProfile={onProfile} onSignOut={onSignOut} onDeleted={onDeleted} />}
      </AppShell>
      <TitleSheet me={profile.id} />
      <EditTitle />
      {quickAddUsed && <Suspense fallback={null}><QuickAdd /></Suspense>}
      <FriendProfile />
      <FeedBatch />
      <FriendTitle />
      <SyncStatus />
      <Toast />
    </LayoutGroup>
  );
}

export function App() {
  const session = useSession();
  if (session.state === 'loading') return <div style={{ padding: 18 }}><Skeleton kind="card" /></div>;
  if (session.state === 'signedOut') return <SignIn onSignIn={session.signIn} />;
  if (session.state === 'blocked') return <NotInvited onSignOut={session.signOut} linkExpired={session.linkExpired} />;
  // A missing profile (the server did not answer) still opens the app with
  // what the session knows; the nickname can be set once it is reachable.
  const profile: ProfileData = session.profile ?? { id: session.userId ?? '', email: session.email ?? '', display_name: null, nickname: null, theme: 'system' };
  if (session.state === 'onboarding') return <Onboarding profile={profile} onDone={session.setProfile} />;
  return (
    <Signed profile={profile} onProfile={session.setProfile}
      onSignOut={async () => {
        await flushQueue();
        // Cleared after signing out, which unmounts Signed and stops sync, so
        // a pull still in flight cannot write the old account back.
        await session.signOut();
        // The next account starts from the skeleton, not an empty board.
        clearMirror();
      }}
      onDeleted={async () => {
        // The account is gone on the server: nothing in the queue may be
        // sent again, so it is dropped with the mirror instead of flushed.
        await session.signOut();
        clearMirror();
      }} />
  );
}
