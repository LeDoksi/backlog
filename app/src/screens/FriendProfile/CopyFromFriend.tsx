import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { useBoards, type Board } from '../../data/boardsStore';
import { getSupabase } from '../../data/supabase';
import { copyFromFriend } from '../../lib/boards';
import type { ShelfItem } from '../../lib/social';
import { resolveCover } from '../../lib/covers';
import { ASSET_ROOT } from '../../config';
import s from './FriendProfile.module.css';

const nameOf = (b: Board) => (b.kind === 'personal' ? 'Моё' : 'Общее');

/** A title from a friend's shelf onto one of my boards: «В Моё» / «В Общее» when I have both. */
export function CopyFromFriend({ owner, item, onClose }: { owner: string; item: ShelfItem | null; onClose(): void }) {
  const boards = useBoards((b) => b.boards);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped per title and per request: an answer for an earlier one is dropped.
  const ticket = useRef(0);

  useEffect(() => { ticket.current += 1; setNote(null); setBusy(false); }, [item]);

  async function copy(board: Board) {
    if (!item || busy) return;
    const mine = ++ticket.current;
    setBusy(true);
    setNote(null);
    const res = await copyFromFriend(getSupabase(), owner, item.id, board.id);
    if (mine !== ticket.current) return;
    setBusy(false);
    setNote(res.ok ? `Добавлено в «${nameOf(board)}»` : res.error === 'duplicate' ? `Уже есть в «${nameOf(board)}»`
      : 'Не получилось добавить. Проверь сеть и попробуй ещё раз.');
    if (res.ok) void useBoards.getState().refresh();
  }

  const two = boards.length > 1;
  return (
    <Sheet open={!!item} onClose={onClose} labelledBy="copy-title">
      {item && (
        <div className={s.copy}>
          <div className={s.copyHead}>
            <div className={s.copyPoster}><img src={resolveCover(item.cover ?? undefined, ASSET_ROOT)} alt="" /></div>
            <div className={s.who}>
              <h2 id="copy-title" className={s.copyName}>{item.title}</h2>
              {item.year && <span className={s.muted}>{item.year}</span>}
            </div>
          </div>
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
      )}
    </Sheet>
  );
}
