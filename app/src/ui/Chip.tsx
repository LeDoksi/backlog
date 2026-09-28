import type { ButtonHTMLAttributes, ReactNode } from 'react';
import s from './Chip.module.css';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { selected?: boolean; count?: number; icon?: ReactNode; tone?: 'plain' | 'accent' }

export function Chip({ selected = false, count, icon, tone = 'plain', children, className, ...rest }: Props) {
  return (
    <button type="button" aria-pressed={selected} {...rest}
      className={[s.chip, tone === 'accent' ? s.accent : '', selected ? s.selected : '', className].filter(Boolean).join(' ')}>
      {icon}{children}{count != null && <span className={s.count}>{count}</span>}
    </button>
  );
}
