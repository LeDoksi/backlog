import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { getSupabase } from '../../data/supabase';
import { useTitles } from '../../data/titlesStore';
import { useBoards } from '../../data/boardsStore';
import { myHiddenTitles, type HiddenTitle } from '../../lib/social';
import { pushTitlePatch } from '../../lib/syncTitles';
import { resolveCover } from '../../lib/covers';
import { CATEGORY_LABEL } from '../../data/labels';
import { ASSET_ROOT } from '../../config';
import type { Category } from '../../lib/types';
import s from './Privacy.module.css';

interface Props { open: boolean; onClose(): void; onCount?(n: number): void }

export function HiddenTitles({ open, onClose, onCount }: Props) {
  const [rows, setRows] = useState<HiddenTitle[] | null>(null);
  const [failed, setFailed] = useState(false);
  const boards = useBoards((b) => b.boards);
  const count = useRef(onCount);
  count.current = onCount;

  useEffect(() => {
    if (!open) return;
    setFailed(false);
    void myHiddenTitles(getSupabase()).then((r) => { setRows(r); if (!r) setFailed(true); else count.current?.(r.length); });
  }, [open]);

  async function show(t: HiddenTitle) {
    const store = useTitles.getState();
    // The open board's titles go through the store (and its offline queue);
    // the other board is not loaded here, so it is written directly.
    const ok = store.boardId === t.workspace_id
      ? (store.editTitle(t.id, { hidden: false }), true)
      : (await pushTitlePatch(getSupabase(), t.workspace_id, t.id, { hidden: false })).ok;
    if (!ok) { setFailed(true); return; }
    const left = (rows ?? []).filter((r) => !(r.workspace_id === t.workspace_id && r.id === t.id));
    setRows(left);
    count.current?.(left.length);
  }

  const boardName = (id: string) => (boards.find((b) => b.id === id)?.kind === 'shared' ? 'Общее' : 'Моё');
  return (
    <Sheet open={open} onClose={onClose} labelledBy="hidden-title">
      <h2 id="hidden-title" className={s.title}>Скрытые тайтлы</h2>
      {failed && <p role="alert" className={s.error}>Не получилось. Проверь сеть и попробуй ещё раз.</p>}
      {rows && rows.length === 0 && <p className={s.empty}>Скрытых нет. Скрыть тайтл от друзей можно в его панели.</p>}
      {rows && rows.length > 0 && (
        <ul className={s.list}>
          {rows.map((t) => (
            <li key={t.workspace_id + '/' + t.id} className={s.item}>
              <img className={s.thumb} src={resolveCover(t.cover ?? undefined, ASSET_ROOT)} alt="" />
              <span className={s.itemText}>
                <span className={s.itemName}>{t.title}</span>
                <span className={s.hint}>{[CATEGORY_LABEL[t.category as Category], t.year, boards.length > 1 ? boardName(t.workspace_id) : null].filter(Boolean).join(', ')}</span>
              </span>
              <button type="button" className={s.show} aria-label={`Показать друзьям «${t.title}»`} onClick={() => void show(t)}>Показать</button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
