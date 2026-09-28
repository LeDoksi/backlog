import type { ReactNode } from 'react';
import { TabBar, type Section } from './TabBar';
import { DeskRail } from './DeskRail';
import s from './AppShell.module.css';

interface Props { sections: Section[]; section: Section; badge?: number; onNavigate: (s: Section) => void; onAdd: () => void; children: ReactNode }

export function AppShell({ sections, section, badge, onNavigate, onAdd, children }: Props) {
  return (
    <div className={s.shell}>
      <DeskRail sections={sections} active={section} badge={badge} onNavigate={onNavigate} onAdd={onAdd} />
      <main className={s.main}>{children}</main>
      <TabBar sections={sections} active={section} badge={badge} onNavigate={onNavigate} onAdd={onAdd} />
    </div>
  );
}
