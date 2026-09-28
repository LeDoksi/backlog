import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Switch } from '../../ui/Switch';
import { getSupabase } from '../../data/supabase';
import * as Auth from '../../lib/auth';
import s from './Profile.module.css';

export function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [addToMine, setAddToMine] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  function close() { setEmail(''); setAddToMine(false); setState('idle'); onClose(); }

  async function send() {
    const value = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) { setState('error'); return; }
    setState('sending');
    const res = await Auth.inviteEmail(getSupabase(), value, addToMine);
    setState(res && res.error ? 'error' : 'sent');
  }

  return (
    <Sheet open={open} onClose={close} labelledBy="invite-title" footer={
      state === 'sent'
        ? <Button className={s.full} onClick={close}>Готово</Button>
        : <Button className={s.full} disabled={state === 'sending'} onClick={() => void send()}>Пригласить</Button>
    }>
      <h2 id="invite-title" className={s.sheetTitle}>Пригласить по email</h2>
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
          <Switch label="Добавить в моё пространство" hint="Человек увидит и сможет менять этот бэклог" checked={addToMine} onChange={setAddToMine} />
        </form>
      )}
    </Sheet>
  );
}
