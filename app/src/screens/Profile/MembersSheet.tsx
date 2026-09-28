import { useEffect, useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Avatar } from '../../ui/Avatar';
import { Confirm } from '../../ui/Confirm';
import { getSupabase } from '../../data/supabase';
import { clearMirror } from '../../data/mirror';
import * as Auth from '../../lib/auth';
import s from './Profile.module.css';

type Member = { id: string; email: string };

export function MembersSheet({ open, onClose, userId }: { open: boolean; onClose: () => void; userId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [target, setTarget] = useState<Member | null>(null);
  const [error, setError] = useState(false);

  const load = () => { void Auth.listWorkspaceMembers(getSupabase()).then(setMembers); };
  useEffect(() => { if (open) { setMembers(null); setError(false); load(); } }, [open]);

  async function act(m: Member) {
    setTarget(null);
    const self = m.id === userId;
    const res = self ? await Auth.leaveWorkspace(getSupabase()) : await Auth.removeMember(getSupabase(), m.id);
    if (res && res.error) { setError(true); return; }
    // Leaving swaps this person into a space of their own: the mirror holds
    // the old space's titles and has to go before anything reads it.
    if (self) { clearMirror(); window.location.reload(); return; }
    load();
  }

  const alone = (members?.length ?? 0) <= 1;
  const self = target?.id === userId;
  return (
    <Sheet open={open} onClose={onClose} labelledBy="members-title">
      <h2 id="members-title" className={s.sheetTitle}>Участники</h2>
      {members === null && <p className={s.muted}>Загружаю…</p>}
      {members && alone && <p className={s.muted}>Пока здесь только ты. Пригласи кого-нибудь по email.</p>}
      {error && <p role="alert" className={s.error}>Не получилось. Попробуй ещё раз.</p>}
      <ul className={s.members}>
        {members?.map((m) => (
          <li key={m.id} className={s.member}>
            <Avatar userId={m.id} name={m.email} size={36} />
            <span className={s.memberMail}>{m.email}{m.id === userId && <span className={s.muted}> (ты)</span>}</span>
            {!alone && (
              <button type="button" className={s.memberAction} onClick={() => setTarget(m)}>{m.id === userId ? 'Выйти' : 'Удалить'}</button>
            )}
          </li>
        ))}
      </ul>
      <Confirm open={!!target} danger confirm={self ? 'Выйти' : 'Удалить'}
        title={self ? 'Выйти из общего пространства?' : `Удалить ${target?.email ?? ''}?`}
        text={self ? 'Ты перестанешь видеть этот бэклог.' : 'Человек перестанет видеть этот бэклог.'}
        onCancel={() => setTarget(null)} onConfirm={() => { if (target) void act(target); }} />
    </Sheet>
  );
}
