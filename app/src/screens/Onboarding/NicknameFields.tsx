import { useEffect, useState } from 'react';
import { Check } from '@phosphor-icons/react';
import { getSupabase } from '../../data/supabase';
import * as Auth from '../../lib/auth';
import s from './Onboarding.module.css';

export type NickStatus = 'idle' | 'checking' | 'free' | 'taken' | 'format' | 'unknown';

const NICK = /^[a-z0-9_]{3,20}$/;

export function nickMessage(status: NickStatus): string {
  switch (status) {
    case 'free': return 'Ник свободен';
    case 'taken': return 'Ник занят';
    case 'format': return 'Только латиница, цифры и _, от 3 до 20';
    case 'unknown': return 'Не удалось проверить ник, нет сети';
    default: return '';
  }
}

// Checked at most once per 400ms of typing; a stale answer for an older
// value never overwrites the current one.
export function useNicknameCheck(nick: string, current: string | null): NickStatus {
  const [status, setStatus] = useState<NickStatus>('idle');
  useEffect(() => {
    const value = nick.trim().toLowerCase();
    if (!value) { setStatus('idle'); return; }
    if (!NICK.test(value)) { setStatus('format'); return; }
    if (current && value === current) { setStatus('free'); return; }
    setStatus('checking');
    let live = true;
    const t = setTimeout(() => {
      void Auth.nicknameAvailable(getSupabase(), value).then((ok) => {
        if (live) setStatus(ok === null ? 'unknown' : ok ? 'free' : 'taken');
      });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [nick, current]);
  return status;
}

interface Props {
  name: string;
  nick: string;
  status: NickStatus;
  onName(v: string): void;
  onNick(v: string): void;
}

export function NicknameFields({ name, nick, status, onName, onNick }: Props) {
  const message = nickMessage(status);
  const bad = status === 'taken' || status === 'format';
  return (
    <>
      <label className={s.field}>
        <span className={s.label}>Имя</span>
        <input className={s.input} type="text" autoComplete="name" value={name} maxLength={40} onChange={(e) => onName(e.target.value)} />
      </label>
      <div className={s.field}>
        <label htmlFor="nick" className={s.label}>Ник</label>
        <div className={[s.nickBox, bad ? s.nickBad : ''].join(' ')}>
          <span className={s.at} aria-hidden="true">@</span>
          <input id="nick" className={s.nickInput} type="text" autoComplete="username" autoCapitalize="none" spellCheck={false}
            inputMode="text" maxLength={20} value={nick} aria-invalid={bad} aria-describedby="nick-status"
            onChange={(e) => onNick(e.target.value.replace(/^@/, '').toLowerCase())} />
          {status === 'free' && <Check size={20} weight="bold" className={s.ok} aria-hidden="true" />}
        </div>
        <span id="nick-status" role="status" className={[s.hint, status === 'free' ? s.ok : bad ? s.bad : ''].join(' ')}>{message}</span>
      </div>
    </>
  );
}
