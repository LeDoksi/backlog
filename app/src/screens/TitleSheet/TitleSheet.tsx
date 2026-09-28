import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { PencilSimple, Trash } from '@phosphor-icons/react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { useTitles } from '../../data/titlesStore';
import { useUi } from '../../data/ui';
import { busy } from '../../data/busy';
import { metaLine } from '../../data/labels';
import { hasPartsChecklist } from '../../lib/storage';
import { resolveCover } from '../../lib/covers';
import { isStillAiring } from '../../lib/query';
import { ASSET_ROOT } from '../../config';
import { StatusControl } from './StatusControl';
import { PartsChecklist } from './PartsChecklist';
import s from './TitleSheet.module.css';

export function TitleSheet() {
  const id = useUi((u) => u.openTitleId);
  const close = useUi((u) => u.closeTitle);
  const openEdit = useUi((u) => u.openEdit);
  const title = useTitles((t) => (id ? t.titles.find((x) => x.id === id) : undefined));
  const checked = useTitles((t) => (id ? t.checked[id] : undefined)) ?? [];
  const store = useTitles.getState;
  const [confirming, setConfirming] = useState(false);
  const reduce = useReducedMotion();
  const open = !!id && !!title;

  useEffect(() => {
    if (!open) return;
    busy.enter('sheet');
    return () => busy.leave('sheet');
  }, [open]);

  // The title can vanish under the panel (deleted on another device).
  useEffect(() => { if (id && !title) close(); }, [id, title, close]);

  const cover = title ? resolveCover(title.cover, ASSET_ROOT) : '';
  const meta = title ? [metaLine(title), (title.genres ?? []).join(', ')].filter(Boolean).join('. ') : '';

  return (
    <>
      <Sheet open={open} onClose={close} labelledBy="title-sheet-title" footer={title && (
        <>
          <Button variant="inverse" className={s.edit} icon={<PencilSimple size={20} aria-hidden="true" />} onClick={() => openEdit(title.id)}>Редактировать</Button>
          <Button variant="danger" className={s.iconBtn} aria-label="Удалить тайтл" onClick={() => setConfirming(true)}><Trash size={20} /></Button>
        </>
      )}>
        {title && (
          <div className={s.content}>
            <img className={s.backdrop} src={cover} alt="" aria-hidden="true" />
            <div className={s.hero}>
              <motion.div layoutId={reduce ? undefined : `poster-${title.id}`} className={s.poster} transition={{ type: 'spring', stiffness: 260, damping: 26 }}>
                <img src={cover} alt="" />
              </motion.div>
              <div className={s.heading}>
                <h2 id="title-sheet-title" className={s.name}>{title.title}</h2>
                {title.originalTitle && title.originalTitle !== title.title && <div className={s.original}>{title.originalTitle}</div>}
                <div className={s.meta}>{meta}</div>
                {isStillAiring(title) && <div className={s.airing}>Всё ещё выходит</div>}
              </div>
            </div>

            {hasPartsChecklist(title) ? (
              <PartsChecklist parts={title.parts} checked={checked}
                onToggle={(i, on) => store().setPartChecked(title.id, i, on)}
                onAllReleased={() => store().setAllReleasedChecked(title.id)} />
            ) : (
              <>
                {title.status === 'unreleased' && <p className={s.unreleased}>Ещё не вышло. Когда выйдет, сними отметку в редактировании.</p>}
                {title.status !== 'unreleased' && <StatusControl value={title.status} onChange={(st) => store().setStatus(title.id, st)} />}
              </>
            )}

            {title.synopsis && <p className={s.synopsis}>{title.synopsis}</p>}
            {title.seasonInfo && <p className={s.seasonInfo}>{title.seasonInfo}</p>}
            {title.category === 'game' && title.platforms && title.platforms.length > 0 && (
              <div className={s.platforms} aria-label="Платформы">{title.platforms.map((p) => <span key={p} className={s.platform}>{p}</span>)}</div>
            )}
          </div>
        )}
      </Sheet>
      <Confirm open={confirming && !!title} danger confirm="Удалить"
        title={title ? `Удалить «${title.title}»?` : ''} text="Это нельзя отменить."
        onCancel={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); if (title) { close(); store().deleteTitle(title.id); } }} />
    </>
  );
}
