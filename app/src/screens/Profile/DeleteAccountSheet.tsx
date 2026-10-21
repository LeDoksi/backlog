import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { getSupabase } from '../../data/supabase';
import * as Auth from '../../lib/auth';
import s from './Profile.module.css';

interface Props { open: boolean; nickname: string | null; onClose(): void; onDeleted(): void }

// Typing the nickname is the confirmation: the server checks it too, so a
// stray tap or a stolen open tab cannot delete the account on its own.
export function DeleteAccountSheet({ open, nickname, onClose, onDeleted }: Props) {
  const [typed, setTyped] = useState('');
  const [state, setState] = useState<'idle' | 'deleting' | 'error' | 'last_admin'>('idle');
  const matches = !!nickname && typed.trim().replace(/^@/, '').toLowerCase() === nickname;

  function close() { setTyped(''); setState('idle'); onClose(); }

  async function remove() {
    if (!matches || !nickname) return;
    setState('deleting');
    const status = await Auth.deleteMyAccount(getSupabase(), nickname);
    if (status === 'deleted') { onDeleted(); return; }
    setState(status === 'last_admin' ? 'last_admin' : 'error');
  }

  return (
    <Sheet open={open} onClose={close} labelledBy="delete-account-title" footer={<>
      <Button variant="neutral" className={s.full} onClick={close}>Отмена</Button>
      <Button variant="danger" className={s.full} disabled={!matches || state === 'deleting'} onClick={() => void remove()}>Удалить аккаунт</Button>
    </>}>
      <h2 id="delete-account-title" className={s.sheetTitle}>Удалить аккаунт?</h2>
      <div className={s.stack}>
        <p className={s.muted}>Твой профиль, личная доска, друзья, заявки и события в ленте будут удалены. Это нельзя отменить.</p>
        <p className={s.muted}>Общая доска останется у второго участника вместе с тайтлами на ней. В резервных копиях базы аккаунт может остаться, пока их не удалят.</p>
        <form className={s.form} onSubmit={(e) => { e.preventDefault(); void remove(); }}>
          <label className={s.field}>
            <span className={s.label}>Чтобы подтвердить, введи свой ник{nickname ? ` @${nickname}` : ''}</span>
            <input className={s.input} type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} value={typed}
              onChange={(e) => { setTyped(e.target.value); if (state !== 'deleting') setState('idle'); }}
              aria-invalid={state === 'error'} aria-describedby={state === 'error' || state === 'last_admin' ? 'delete-error' : undefined} />
          </label>
          {state === 'error' && <p id="delete-error" role="alert" className={s.error}>Не получилось удалить. Проверь сеть и попробуй ещё раз.</p>}
          {state === 'last_admin' && <p id="delete-error" role="alert" className={s.error}>Ты единственный админ: без тебя приглашать станет некому. Сначала назначь другого админа.</p>}
        </form>
      </div>
    </Sheet>
  );
}
