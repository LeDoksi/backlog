import { useState } from 'react';
import { ChartBar, Moon, Plus, SquaresFour, Sun, UserCircle, UsersThree } from '@phosphor-icons/react';
import { SECTION_LABEL, type Section } from './TabBar';
import { readTheme, setTheme } from '../design/theme';
import s from './DeskRail.module.css';

const ICON = { backlog: SquaresFour, friends: UsersThree, stats: ChartBar, profile: UserCircle };

interface Props { sections: Section[]; active: Section; badge?: number; onNavigate: (s: Section) => void; onAdd: () => void }

// The rail's button is a quick flip between the two themes; the full
// "Светлая / Тёмная / Как в системе" choice lives in the profile.
function effectiveDark(): boolean {
  const pref = readTheme();
  if (pref !== 'system') return pref === 'dark';
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function DeskRail({ sections, active, badge = 0, onNavigate, onAdd }: Props) {
  const [dark, setDark] = useState(effectiveDark);

  function flipTheme() {
    const next = dark ? 'light' : 'dark';
    setTheme(next);
    setDark(!dark);
  }

  return (
    <aside className={s.rail}>
      <button type="button" aria-label="Добавить тайтл" className={s.fab} onClick={onAdd}><Plus size={26} weight="bold" /></button>
      <nav aria-label="Разделы" className={s.capsule}>
        {sections.map((key) => {
          const Icon = ICON[key];
          const on = key === active;
          return (
            <button key={key} type="button" aria-current={on ? 'page' : undefined} className={on ? `${s.item} ${s.on}` : s.item} onClick={() => onNavigate(key)}>
              <Icon size={22} weight={on ? 'fill' : 'regular'} aria-hidden="true" />
              {SECTION_LABEL[key]}
              {key === 'friends' && badge > 0 && !on && <span className={s.badge}>{badge}</span>}
            </button>
          );
        })}
      </nav>
      <div className={s.spacer} />
      <button type="button" aria-label={dark ? 'Светлая тема' : 'Тёмная тема'} className={s.theme} onClick={flipTheme}>
        {dark ? <Sun size={20} /> : <Moon size={20} />}
      </button>
    </aside>
  );
}
