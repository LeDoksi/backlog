import { useEffect, useState } from 'react';
import { LayoutGroup } from 'motion/react';
import { useSession } from './data/session';
import { useTitles, mirror, outbox } from './data/titlesStore';
import { useBoards } from './data/boardsStore';
import { startSync } from './data/syncEngine';
import { getSupabase } from './data/supabase';
import { useUi } from './data/ui';
import { SignIn } from './screens/SignIn';
import { NotInvited } from './screens/NotInvited';
import { Onboarding } from './screens/Onboarding/Onboarding';
import { Backlog } from './screens/Backlog/Backlog';
import { TitleSheet } from './screens/TitleSheet/TitleSheet';
import { EditTitle } from './screens/EditTitle/EditTitle';
import { QuickAdd } from './screens/QuickAdd/QuickAdd';
import { Stats } from './screens/Stats/Stats';
import { Profile } from './screens/Profile/Profile';
import { Friends } from './screens/Friends/Friends';
import { useSocial } from './data/socialStore';
import { clearMirror, flushQueue } from './data/mirror';
import { SyncStatus } from './ui/SyncStatus';
import { AppShell } from './ui/AppShell';
import type { Section } from './ui/TabBar';
import { Skeleton } from './ui/Skeleton';
import type { Profile as ProfileData } from './lib/auth';

const SECTIONS: Section[] = ['backlog', 'friends', 'stats', 'profile'];
// The badge is the only notification (decision 38); it is re-read when the
// app comes back to the foreground and every few minutes while it is open.
const BADGE_EVERY_MS = 3 * 60 * 1000;

interface SignedProps { profile: ProfileData; onProfile(p: ProfileData): void; onSignOut(): void }

function Signed({ profile, onProfile, onSignOut }: SignedProps) {
  const [section, setSection] = useState<Section>('backlog');
  const setQuickAdd = useUi((u) => u.setQuickAdd);

  useEffect(() => startSync({ store: useTitles, storage: mirror, outbox, client: getSupabase }), []);
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
      <AppShell sections={SECTIONS} section={section} badge={badge} onNavigate={(next) => { setSection(next); window.scrollTo(0, 0); }} onAdd={() => setQuickAdd(true)}>
        {section === 'backlog' && <Backlog />}
        {section === 'friends' && <Friends />}
        {section === 'stats' && <Stats />}
        {section === 'profile' && <Profile profile={profile} onProfile={onProfile} onSignOut={onSignOut} />}
      </AppShell>
      <TitleSheet />
      <EditTitle />
      <QuickAdd />
      <SyncStatus />
    </LayoutGroup>
  );
}

export function App() {
  const session = useSession();
  if (session.state === 'loading') return <div style={{ padding: 18 }}><Skeleton kind="card" /></div>;
  if (session.state === 'signedOut') return <SignIn onSignIn={session.signIn} />;
  if (session.state === 'blocked') return <NotInvited onSignOut={session.signOut} />;
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
      }} />
  );
}
