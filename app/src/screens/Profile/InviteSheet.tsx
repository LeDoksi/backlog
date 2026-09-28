import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { getSupabase } from '../../data/supabase';
import * as Auth from '../../lib/auth';
import s from './Profile.module.css';

// Lets someone into the app. Boards are joined separately, by nickname.
export function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  function close() { setEmail(''); setState('idle'); onClose(); }

  async function send() {
    const value = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) { setState('error'); return; }
    setState('sending');
    const res = await Auth.inviteEmail(getSupabase(), value);
    setState(res && res.error ? 'error' : 'sent');
  }

  return (
    <Sheet open={open} onClose={close} labelledBy="invite-title" footer={
      state === 'sent'
        ? <Button className={s.full} onClick={close}>Готово</Button>
        : <Button className={s.full} disabled={state === 'sending'} onClick={() => void send()}>Пригласить</Button>
    }>
      <h2 id="invite-title" className={s.sheetTitle}>Пригласить в Бэклог</h2>
      {state === 'sent' ? (
        <p className={s.muted} role="status">Готово. Пусть {email.trim()} войдёт через Google с этой почтой.</p>
      ) : (
        <form className={s.form} onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <label className={s.field}>
            <span className={s.label}>Почта Google</span>
            <input className={s.input} type="email" inputMode="email" autoComplete="off" value={email}
              onChange={(e) => { setEmail(e.target.value); if (state === 'error') setState('idle'); }}
              aria-invalid={state === 'error'} aria-describedby={state === 'error' ? 'invite-error' : undefined} />
            {state === 'error' && <span id="invite-error" role="alert" className={s.error}>Не удалось пригласить. Проверь адрес.</span>}
          </label>
          <p className={s.muted}>Человек получит доступ к приложению со своей личной доской.</p>
        </form>
      )}
    </Sheet>
  );
}
