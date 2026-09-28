import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { getSupabase } from '../../data/supabase';
import { flushQueue } from '../../data/mirror';
import { useBoards } from '../../data/boardsStore';
import { leaveSharedBoard, removeBoardMember } from '../../lib/boards';
import type { BoardMember, BoardRow } from '../../lib/auth';
import s from './Profile.module.css';

interface Props { open: boolean; onClose(): void; board: BoardRow | null; userId: string; onInvite(): void }

export function MembersSheet({ open, onClose, board, userId, onInvite }: Props) {
  const [target, setTarget] = useState<BoardMember | null>(null);
  const [error, setError] = useState(false);
  const members = board?.members ?? [];

  async function act(m: BoardMember) {
    setTarget(null);
    setError(false);
    const self = m.id === userId;
    // Edits still queued for this board go before access to it does.
    if (self) await flushQueue();
    const res = self ? await leaveSharedBoard(getSupabase()) : await removeBoardMember(getSupabase(), m.id);
    if (!res.ok) { setError(true); return; }
    // Refreshing the list moves anyone who left onto their personal board.
    await useBoards.getState().refresh();
    if (self) onClose();
  }

  const self = target?.id === userId;
  return (
    <Sheet open={open} onClose={() => { setError(false); onClose(); }} labelledBy="members-title"
      footer={<Button variant="tonal" className={s.full} onClick={onInvite}>Пригласить в общую доску</Button>}>
      <h2 id="members-title" className={s.sheetTitle}>Участники</h2>
      <p className={s.muted}>Менять доску может любой участник.</p>
      {error && <p role="alert" className={s.error}>Не получилось. Проверь сеть и попробуй ещё раз.</p>}
      <ul className={s.members}>
        {members.map((m) => (
          <li key={m.id} className={s.member}>
            <Avatar userId={m.id} name={m.name} size={36} />
            <span className={s.memberMail}>
              {m.name}{m.nickname && <span className={s.muted}> @{m.nickname}</span>}{m.id === userId && <span className={s.muted}> (ты)</span>}
            </span>
            <button type="button" className={s.memberAction} onClick={() => setTarget(m)}>{m.id === userId ? 'Выйти' : 'Удалить'}</button>
          </li>
        ))}
      </ul>
      <Confirm open={!!target} danger confirm={self ? 'Выйти' : 'Удалить'}
        title={self ? 'Выйти из общей доски?' : `Удалить ${target?.name ?? ''} из общей доски?`}
        text={self ? 'Ты перестанешь видеть эту доску. Твоя личная доска останется.' : 'Человек перестанет видеть эту доску.'}
        onCancel={() => setTarget(null)} onConfirm={() => { if (target) void act(target); }} />
    </Sheet>
  );
}
