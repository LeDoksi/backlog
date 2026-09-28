import { useState } from 'react';
import { useSession } from './data/session';
import { SignIn } from './screens/SignIn';
import { NotInvited } from './screens/NotInvited';
import { AppShell } from './ui/AppShell';
import type { Section } from './ui/TabBar';
import { Skeleton } from './ui/Skeleton';

const SECTIONS: Section[] = ['backlog', 'stats', 'profile'];

export function App() {
  const session = useSession();
  const [section, setSection] = useState<Section>('backlog');

  if (session.state === 'loading') return <div style={{ padding: 18 }}><Skeleton kind="card" /></div>;
  if (session.state === 'signedOut') return <SignIn onSignIn={session.signIn} />;
  if (session.state === 'blocked') return <NotInvited onSignOut={session.signOut} />;
  return (
    <AppShell sections={SECTIONS} section={section} onNavigate={setSection} onAdd={() => {}}>
      <h1 style={{ fontFamily: 'var(--font-display)' }}>Бэклог</h1>
    </AppShell>
  );
}
