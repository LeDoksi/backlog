import { useEffect, useState } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import { useUi } from '../../data/ui';
import { getSupabase } from '../../data/supabase';
import { friendTitle, type FriendTitleData } from '../../lib/social';
import { resolveCover } from '../../lib/covers';
import { CATEGORY_LABEL } from '../../data/labels';
import { addedText } from '../../data/feedFormat';
import { ASSET_ROOT } from '../../config';
import type { Category } from '../../lib/types';
import s from './FeedBatch.module.css';

// The titles behind a «+N тайтлов» feed line, big enough to tell apart.
// A tap opens the title's own card over this list; the friend's «Хочет»
// shelf is one tap away for the rest.
export function FeedBatch() {
  const batch = useUi((u) => u.feedBatch);
  const close = useUi((u) => u.closeFeedBatch);
  const openFriendTitle = useUi((u) => u.openFriendTitle);
  const [rows, setRows] = useState<FriendTitleData[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!batch) return;
    let live = true;
    setRows(null);
    setFailed(false);
    void Promise.all(batch.ids.map((id) => friendTitle(getSupabase(), batch.owner, id))).then((got) => {
      if (!live) return;
      if (got.some((g) => g === null)) setFailed(true);
      // A title hidden or deleted since the line was written drops out.
      setRows(got.filter((g): g is FriendTitleData => !!g && g !== 'none'));
    });
    return () => { live = false; };
  }, [batch]);

  function toShelf() {
    if (!batch) return;
    close();
    useUi.getState().openFriend(batch.owner, 'want');
  }

  const meta = (t: FriendTitleData) => [CATEGORY_LABEL[t.category as Category], t.year].filter(Boolean).join(', ');
  return (
    <Sheet open={!!batch} onClose={close} labelledBy="feed-batch-title"
      footer={batch && <Button variant="tonal" className={s.shelf} onClick={toShelf}>Вся полка «Хочет»</Button>}>
      {batch && (
        <>
          <h2 id="feed-batch-title" className={s.title}>{batch.name} · {addedText(batch.count)}</h2>
          {failed && <p role="alert" className={s.error}>Не загрузилось. Проверь сеть.</p>}
          {!rows && !failed && <div className={s.list}>{batch.ids.slice(0, 4).map((id) => <Skeleton key={id} kind="row" />)}</div>}
          {rows && (
            <ul className={s.list}>
              {rows.map((t) => (
                <li key={t.id}>
                  <button type="button" className={s.row} aria-label={`«${t.title}», ${meta(t)}`} onClick={() => openFriendTitle(batch.owner, t.id, batch.name)}>
                    <img className={s.cover} src={resolveCover(t.cover ?? undefined, ASSET_ROOT)} alt="" loading="lazy" decoding="async" />
                    <span className={s.text}>
                      <span className={s.name}>{t.title}</span>
                      <span className={s.meta}>{meta(t)}</span>
                    </span>
                    <CaretRight size={18} className={s.caret} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Sheet>
  );
}
