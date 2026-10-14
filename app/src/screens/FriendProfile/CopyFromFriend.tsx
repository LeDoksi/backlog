import { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui/Button';
import { useBoards, type Board } from '../../data/boardsStore';
import { getSupabase } from '../../data/supabase';
import { copyFromFriend } from '../../lib/boards';
import s from './FriendProfile.module.css';

const nameOf = (b: Board) => (b.kind === 'personal' ? 'Моё' : 'Общее');

/** A friend's title onto one of my boards: «В Моё» / «В Общее» when I have both. */
export function CopyButtons({ owner, id }: { owner: string; id: string }) {
  const boards = useBoards((b) => b.boards);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped per title and per request: an answer for an earlier one is dropped.
  const ticket = useRef(0);

  useEffect(() => { ticket.current += 1; setNote(null); setBusy(false); }, [owner, id]);

  async function copy(board: Board) {
    if (busy) return;
    const mine = ++ticket.current;
    setBusy(true);
    setNote(null);
    const res = await copyFromFriend(getSupabase(), owner, id, board.id);
    if (mine !== ticket.current) return;
    setBusy(false);
    setNote(res.ok ? `Добавлено в «${nameOf(board)}»` : res.error === 'duplicate' ? `Уже есть в «${nameOf(board)}»`
      : 'Не получилось добавить. Проверь сеть и попробуй ещё раз.');
    if (res.ok) void useBoards.getState().refresh();
  }

  const two = boards.length > 1;
  return (
    <div className={s.copy}>
      {two ? (
        <div className={s.copyActions} role="group" aria-labelledby="copy-label">
          <span id="copy-label" className={s.copyLabel}>Добавить к себе</span>
          {boards.map((b) => (
            <Button key={b.id} variant="neutral" aria-busy={busy} onClick={() => void copy(b)}>{`В ${nameOf(b)}`}</Button>
          ))}
        </div>
      ) : boards[0] && (
        <Button variant="inverse" aria-busy={busy} onClick={() => void copy(boards[0]!)}>Добавить к себе</Button>
      )}
      {note && <p role="status" className={s.copyNote}>{note}</p>}
    </div>
  );
}
