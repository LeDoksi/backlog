import { ChartBar, Plus, SquaresFour, UserCircle, UsersThree } from '@phosphor-icons/react';
import s from './TabBar.module.css';

export type Section = 'backlog' | 'friends' | 'stats' | 'profile';
export const SECTION_LABEL: Record<Section, string> = { backlog: 'Бэклог', friends: 'Друзья', stats: 'Итоги', profile: 'Профиль' };
const ICON = { backlog: SquaresFour, friends: UsersThree, stats: ChartBar, profile: UserCircle };

interface Props { sections: Section[]; active: Section; badge?: number; onNavigate: (s: Section) => void; onAdd: () => void }

export function TabBar({ sections, active, badge = 0, onNavigate, onAdd }: Props) {
  return (
    <div className={s.wrap}>
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
      <button type="button" aria-label="Добавить тайтл" className={s.fab} onClick={onAdd}><Plus size={28} weight="bold" /></button>
    </div>
  );
}
