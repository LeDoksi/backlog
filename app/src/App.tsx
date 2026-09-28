import { useEffect, useState } from 'react';
import { LayoutGroup } from 'motion/react';
import { useSession } from './data/session';
import { useTitles, mirror } from './data/titlesStore';
import { startSync } from './data/syncEngine';
import { getSupabase } from './data/supabase';
import { useUi } from './data/ui';
import { SignIn } from './screens/SignIn';
import { NotInvited } from './screens/NotInvited';
import { Backlog } from './screens/Backlog/Backlog';
import { TitleSheet } from './screens/TitleSheet/TitleSheet';
import { EditTitle } from './screens/EditTitle/EditTitle';
import { AppShell } from './ui/AppShell';
import type { Section } from './ui/TabBar';
import { Skeleton } from './ui/Skeleton';

const SECTIONS: Section[] = ['backlog', 'stats', 'profile'];

function Signed() {
  const [section, setSection] = useState<Section>('backlog');
  const setQuickAdd = useUi((u) => u.setQuickAdd);

  useEffect(() => startSync({ store: useTitles, storage: mirror, client: getSupabase }), []);

  return (
    <LayoutGroup>
      <AppShell sections={SECTIONS} section={section} onNavigate={setSection} onAdd={() => setQuickAdd(true)}>
        {section === 'backlog' && <Backlog />}
      </AppShell>
      <TitleSheet />
      <EditTitle />
    </LayoutGroup>
  );
}

export function App() {
  const session = useSession();
  if (session.state === 'loading') return <div style={{ padding: 18 }}><Skeleton kind="card" /></div>;
  if (session.state === 'signedOut') return <SignIn onSignIn={session.signIn} />;
  if (session.state === 'blocked') return <NotInvited onSignOut={session.signOut} />;
  return <Signed />;
}
