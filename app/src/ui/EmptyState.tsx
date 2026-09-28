import type { ReactNode } from 'react';
import s from './EmptyState.module.css';

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className={s.wrap}>
      <div className={s.stack} aria-hidden="true"><span /><span /><span className={s.front}>+</span></div>
      <h2 className={s.title}>{title}</h2>
      <p className={s.text}>{text}</p>
      {action}
    </div>
  );
}
