import { useEffect, useState } from 'react';
import { ArrowSquareOut, PencilSimple, Trash } from '@phosphor-icons/react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Segmented';
import { useOther } from '../../data/otherStore';
import { useUi } from '../../data/ui';
import { busy } from '../../data/busy';
import { OTHER_STATUS_LABEL, linkDomain, type OtherItem, type OtherStatus } from '../../lib/other';
import { RatingControl } from '../TitleSheet/RatingControl';
import s from './Other.module.css';

const FAILED = 'Не получилось сохранить. Проверь сеть и попробуй ещё раз.';

// One line of «Другое»: status and rating for anyone on the board; the text
// is changed and the line deleted by whoever wrote it.
export function OtherSheet() {
  const id = useOther((o) => o.openId);
  const item = useOther((o) => (o.openId ? o.items.find((i) => i.id === o.openId) : undefined));
  const close = () => useOther.getState().open(null);
  // Shown at once; the server's answer is the truth either way.
  const [draft, setDraft] = useState<Pick<OtherItem, 'status' | 'rating'> | null>(null);
  const open = !!id && !!item;
  useEffect(() => { setDraft(null); }, [id]);
  useEffect(() => {
    if (!open) return;
    busy.enter('sheet');
    return () => busy.leave('sheet');
  }, [open]);
  // The line can vanish under the panel (deleted by the other member).
  useEffect(() => { if (id && !item) close(); }, [id, item]);

  async function change(patch: Partial<Pick<OtherItem, 'status' | 'rating'>>) {
    if (!item) return;
    const next = { status: draft?.status ?? item.status, rating: draft ? draft.rating : item.rating, ...patch };
    setDraft(next);
    const { mine: _mine, ...rest } = item;
    const res = await useOther.getState().save({ ...rest, ...next });
    setDraft(null);
    if (!res.ok) useUi.getState().showToast(FAILED);
  }

  async function remove(line: OtherItem) {
    close();
    const gone = await useOther.getState().remove(line.id);
    if (!gone) { useUi.getState().showToast('Не получилось удалить. Проверь сеть и попробуй ещё раз.'); return; }
    useUi.getState().showToast(`Удалено «${gone.title}»`, {
      label: 'Отменить',
      run: () => { void useOther.getState().restore(gone).then((ok) => { if (!ok) useUi.getState().showToast(FAILED); }); }
    });
  }

  const status = draft?.status ?? item?.status ?? 'want';
  const rating = draft ? draft.rating : item?.rating ?? null;

  return (
    <Sheet open={open} onClose={close} labelledBy="other-sheet-title" footer={item && (item.mine ? (
      <>
        <Button variant="inverse" className={s.grow} icon={<PencilSimple size={20} aria-hidden="true" />}
          onClick={() => { close(); useOther.getState().openForm({ id: item.id }); }}>Изменить</Button>
        <Button variant="danger" className={s.iconBtn} aria-label="Удалить" onClick={() => void remove(item)}><Trash size={22} /></Button>
      </>
    ) : null)}>
      {item && (
        <div className={s.content}>
          <div className={s.heading}>
            <h2 id="other-sheet-title" className={s.name}>{item.title}</h2>
            <div className={s.meta}>{item.category}</div>
          </div>
          <Segmented label="Статус" value={status} onChange={(v: OtherStatus) => { if (v !== status) void change({ status: v }); }}
            options={(['want', 'done'] as const).map((v) => ({ value: v, label: OTHER_STATUS_LABEL[v] }))} />
          <RatingControl value={rating} prompt={status === 'done' && rating == null} onChange={(v) => void change({ rating: v })} />
          {item.description && <p className={s.description}>{item.description}</p>}
          {item.links.length > 0 && (
            <section className={s.section} aria-labelledby="other-links-title">
              <h3 id="other-links-title" className={s.sectionTitle}>Ссылки</h3>
              <ul className={s.links}>
                {item.links.map((l) => (
                  <li key={l}><a className={s.link} href={l} target="_blank" rel="noopener noreferrer nofollow">{linkDomain(l)}<ArrowSquareOut size={16} aria-hidden="true" /></a></li>
                ))}
              </ul>
            </section>
          )}
          {!item.mine && <p className={s.note}>Текст меняет тот, кто добавил запись. Статус и оценку можно менять.</p>}
        </div>
      )}
    </Sheet>
  );
}
