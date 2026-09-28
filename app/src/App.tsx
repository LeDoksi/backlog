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
import { Backlog } from './screens/Backlog/Backlog';
import { TitleSheet } from './screens/TitleSheet/TitleSheet';
import { EditTitle } from './screens/EditTitle/EditTitle';
import { QuickAdd } from './screens/QuickAdd/QuickAdd';
import { Stats } from './screens/Stats/Stats';
import { Profile } from './screens/Profile/Profile';
import { clearMirror, flushQueue } from './data/mirror';
import { SyncStatus } from './ui/SyncStatus';
import { AppShell } from './ui/AppShell';
import type { Section } from './ui/TabBar';
import { Skeleton } from './ui/Skeleton';

const SECTIONS: Section[] = ['backlog', 'stats', 'profile'];

function Signed({ userId, email, onSignOut }: { userId: string; email: string; onSignOut: () => void }) {
  const [section, setSection] = useState<Section>('backlog');
  const setQuickAdd = useUi((u) => u.setQuickAdd);

  useEffect(() => startSync({ store: useTitles, storage: mirror, outbox, client: getSupabase }), []);
  useEffect(() => { void useBoards.getState().refresh(); }, []);

  return (
    <LayoutGroup>
      <AppShell sections={SECTIONS} section={section} onNavigate={(next) => { setSection(next); window.scrollTo(0, 0); }} onAdd={() => setQuickAdd(true)}>
        {section === 'backlog' && <Backlog />}
        {section === 'stats' && <Stats />}
        {section === 'profile' && <Profile userId={userId} email={email} onSignOut={onSignOut} />}
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
  return (
    <Signed userId={session.userId ?? ''} email={session.email ?? ''}
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
