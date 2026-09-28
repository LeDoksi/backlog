import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Avatar } from '../../ui/Avatar';
import { getSupabase } from '../../data/supabase';
import { findUserByNick, inviteToSharedBoard, normalizeNick, type FoundUser } from '../../lib/boards';
import { boardErrorText } from './boardTexts';
import s from './Profile.module.css';

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'found'; user: FoundUser } | { kind: 'sent'; user: FoundUser } | { kind: 'error'; text: string };

// Exact nickname match only: the search is for someone you already know.
export function NickInviteSheet({ open, onClose, creating }: { open: boolean; onClose: () => void; creating: boolean }) {
  const [nick, setNick] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const value = normalizeNick(nick);

  function close() { setNick(''); setState({ kind: 'idle' }); onClose(); }

  async function find() {
    if (!value) return;
    setState({ kind: 'busy' });
    const user = await findUserByNick(getSupabase(), value);
    setState(user ? { kind: 'found', user } : { kind: 'error', text: `Не нашли @${value}. Проверь ник целиком.` });
  }

  async function invite(user: FoundUser) {
    setState({ kind: 'busy' });
    const res = await inviteToSharedBoard(getSupabase(), user.id);
    setState(res.ok ? { kind: 'sent', user } : { kind: 'error', text: boardErrorText(res.error, user.nickname) });
  }

  const title = creating ? 'Создать общую доску' : 'Пригласить в общую доску';
  const footer = state.kind === 'sent'
    ? <Button className={s.full} onClick={close}>Готово</Button>
    : state.kind === 'found'
      ? <Button className={s.full} onClick={() => void invite(state.user)}>Пригласить @{state.user.nickname}</Button>
      : <Button className={s.full} disabled={!value || state.kind === 'busy'} onClick={() => void find()}>Найти</Button>;

  return (
    <Sheet open={open} onClose={close} labelledBy="nick-invite-title" footer={footer}>
      <h2 id="nick-invite-title" className={s.sheetTitle}>{title}</h2>
      {state.kind === 'sent' ? (
        <p className={s.muted} role="status">Приглашение отправлено. Когда @{state.user.nickname} примет его в профиле, доска появится у вас обоих.</p>
      ) : (
        <form className={s.form} onSubmit={(e) => { e.preventDefault(); if (state.kind !== 'found') void find(); }}>
          <label className={s.field}>
            <span className={s.label}>Ник</span>
            <input className={s.input} type="text" autoCapitalize="none" spellCheck={false} autoComplete="off" placeholder="@ник" value={nick}
              onChange={(e) => { setNick(e.target.value); setState({ kind: 'idle' }); }}
              aria-invalid={state.kind === 'error'} aria-describedby={state.kind === 'error' ? 'nick-invite-error' : undefined} />
          </label>
          {state.kind === 'found' && (
            <div className={s.member}>
              <Avatar userId={state.user.id} name={state.user.name} size={36} />
              <span className={s.memberMail}>{state.user.name} <span className={s.muted}>@{state.user.nickname}</span></span>
            </div>
          )}
          {state.kind === 'error' && <p id="nick-invite-error" role="alert" className={s.error}>{state.text}</p>}
          {creating && state.kind === 'idle' && <p className={s.muted}>Доска появится, когда человек примет приглашение. Твоё личное останется только твоим.</p>}
        </form>
      )}
    </Sheet>
  );
}
