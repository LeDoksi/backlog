import type { ButtonHTMLAttributes, ReactNode } from 'react';
import s from './Button.module.css';

type Variant = 'primary' | 'tonal' | 'neutral' | 'danger' | 'inverse';
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: 'md' | 'lg'; icon?: ReactNode }

export function Button({ variant = 'primary', size = 'md', icon, children, className, ...rest }: Props) {
  return (
    <button type="button" {...rest} className={[s.btn, s[variant], s[size], className].filter(Boolean).join(' ')}>
      {icon}{children}
    </button>
  );
}
