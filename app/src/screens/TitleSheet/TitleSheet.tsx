import { useEffect, useState } from 'react';
import { DotsThree, EyeSlash, PencilSimple } from '@phosphor-icons/react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
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
import { FriendsOnTitle } from './FriendsOnTitle';
import { RatingControl } from './RatingControl';
import s from './TitleSheet.module.css';

export function TitleSheet() {
  const id = useUi((u) => u.openTitleId);
  const close = useUi((u) => u.closeTitle);
  const openEdit = useUi((u) => u.openEdit);
  const title = useTitles((t) => (id ? t.titles.find((x) => x.id === id) : undefined));
  const checked = useTitles((t) => (id ? t.checked[id] : undefined)) ?? [];
  const store = useTitles.getState;
  const [menu, setMenu] = useState(false);
  const open = !!id && !!title;
  useEffect(() => {
    if (!open) return;
    busy.enter('sheet');
    return () => busy.leave('sheet');
  }, [open]);

  useEffect(() => { setMenu(false); }, [id]);

  // The title can vanish under the panel (deleted on another device).
  useEffect(() => { if (id && !title) close(); }, [id, title, close]);

  // Gone at once; «Отменить» on the note brings it back (spec 1.7).
  function remove(titleId: string, name: string) {
    setMenu(false);
    close();
    store().deleteTitle(titleId);
    useUi.getState().showToast(`Удалено «${name}»`, { label: 'Отменить', run: () => store().undoDelete() });
  }

  const cover = title ? resolveCover(title.cover, ASSET_ROOT) : '';
  const meta = title ? [metaLine(title), (title.genres ?? []).join(', ')].filter(Boolean).join('. ') : '';

  return (
    <>
      <Sheet open={open} onClose={close} labelledBy="title-sheet-title" footer={title && (
        <>
          <Button variant="inverse" className={s.edit} icon={<PencilSimple size={20} aria-hidden="true" />} onClick={() => openEdit(title.id)}>Редактировать</Button>
          <div className={s.moreWrap}>
            <Button variant="neutral" className={s.iconBtn} aria-label="Ещё" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <DotsThree size={24} weight="bold" />
            </Button>
            {menu && (
              <div className={s.menu} role="group" aria-label="Ещё">
                <button type="button" className={s.menuItem} onClick={() => { setMenu(false); store().editTitle(title.id, { hidden: !title.hidden }); }}>
                  {title.hidden ? 'Показать друзьям' : 'Скрыть от друзей'}
                </button>
                <button type="button" className={`${s.menuItem} ${s.menuDanger}`} onClick={() => remove(title.id, title.title)}>Удалить</button>
              </div>
            )}
          </div>
        </>
      )}>
        {title && (
          <div className={s.content}>
            <img className={s.backdrop} src={cover} alt="" aria-hidden="true" />
            <div className={s.hero}>
              <div className={s.poster}>
                <img src={cover} alt="" />
              </div>
              <div className={s.heading}>
                <h2 id="title-sheet-title" className={s.name}>{title.title}</h2>
                {title.originalTitle && title.originalTitle !== title.title && <div className={s.original}>{title.originalTitle}</div>}
                <div className={s.meta}>{meta}</div>
                {isStillAiring(title) && <div className={s.airing}>Всё ещё выходит</div>}
                {title.hidden && <div className={s.hiddenNote}><EyeSlash size={14} aria-hidden="true" />Скрыт от друзей</div>}
              </div>
            </div>

            {hasPartsChecklist(title) ? (
              <PartsChecklist parts={title.parts} checked={checked}
                onToggle={(i, on) => store().setPartChecked(title.id, i, on)}
                onAllReleased={() => store().setAllReleasedChecked(title.id)} />
            ) : (
              <>
                {title.status === 'unreleased' && <p className={s.unreleased}>Ещё не вышло. Когда выйдет, сними отметку в редактировании.</p>}
                {title.status !== 'unreleased' && <StatusControl value={title.status} category={title.category} onChange={(st) => store().setStatus(title.id, st)} />}
              </>
            )}

            {title.status !== 'unreleased' && (
              <RatingControl value={title.rating ?? null} prompt={title.status === 'done' && title.rating == null}
                onChange={(v) => store().setRating(title.id, v)} />
            )}

            <FriendsOnTitle title={title} />
            {title.synopsis && <p className={s.synopsis}>{title.synopsis}</p>}
            {title.seasonInfo && <p className={s.seasonInfo}>{title.seasonInfo}</p>}
            {title.category === 'game' && title.platforms && title.platforms.length > 0 && (
              <div className={s.platforms} aria-label="Платформы">{title.platforms.map((p) => <span key={p} className={s.platform}>{p}</span>)}</div>
            )}
          </div>
        )}
      </Sheet>
    </>
  );
}
