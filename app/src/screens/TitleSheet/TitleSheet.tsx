import { useEffect, useRef, useState } from 'react';
import { DotsThree, Eye, EyeSlash, PencilSimple } from '@phosphor-icons/react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Popover } from '../../ui/Popover';
import { useTitles } from '../../data/titlesStore';
import { useUi } from '../../data/ui';
import { busy } from '../../data/busy';
import { metaLine } from '../../data/labels';
import { hasPartsChecklist } from '../../lib/storage';
import { resolveCover } from '../../lib/covers';
import { Cover } from '../../ui/Cover';
import { synopsisText } from '../../lib/synopsis';
import { isStillAiring } from '../../lib/query';
import { cinemaLabel, isSearchCard, localDay } from '../../lib/release';
import { ASSET_ROOT } from '../../config';
import { StatusControl } from './StatusControl';
import { PartsChecklist } from './PartsChecklist';
import { FriendsOnTitle } from './FriendsOnTitle';
import { RatingControl } from './RatingControl';
import s from './TitleSheet.module.css';

/** `me`: the signed-in person, who edits the hand-made cards they made (BL-118). */
export function TitleSheet({ me }: { me?: string | null }) {
  const id = useUi((u) => u.openTitleId);
  const close = useUi((u) => u.closeTitle);
  const openEdit = useUi((u) => u.openEdit);
  const title = useTitles((t) => (id ? t.titles.find((x) => x.id === id) : undefined));
  const checked = useTitles((t) => (id ? t.checked[id] : undefined)) ?? [];
  const store = useTitles.getState;
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
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
  const cinema = title ? cinemaLabel(title, localDay(new Date())) : null;
  // A card from search is nobody's to edit; a hand-made one its author's (or anyone's, made before authors were kept).
  const editable = !!title && !isSearchCard(title) && (!title.createdBy || title.createdBy === me);

  function toggleHidden(t: { id: string; hidden?: boolean }) { store().editTitle(t.id, { hidden: !t.hidden }); }

  return (
    <>
      <Sheet open={open} onClose={close} labelledBy="title-sheet-title" footer={title && (editable ? (
        <>
          <Button variant="inverse" className={s.edit} icon={<PencilSimple size={20} aria-hidden="true" />} onClick={() => openEdit(title.id)}>Редактировать</Button>
          <div className={s.moreWrap}>
            <Button ref={moreRef} variant="neutral" className={s.iconBtn} aria-label="Ещё" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <DotsThree size={24} weight="bold" />
            </Button>
            <Popover open={menu} onClose={() => setMenu(false)} anchor={moreRef} label="Ещё" align="end" side="above" className={s.menu}>
              <div className={s.menuList}>
                <button type="button" className={s.menuItem} onClick={() => { setMenu(false); toggleHidden(title); }}>
                  {title.hidden ? 'Показать друзьям' : 'Скрыть от друзей'}
                </button>
                <button type="button" className={`${s.menuItem} ${s.menuDanger}`} onClick={() => remove(title.id, title.title)}>Удалить</button>
              </div>
            </Popover>
          </div>
        </>
      ) : (
        // A card from search looks as its source does: nothing to edit (BL-118).
        <>
          <Button variant="neutral" className={s.edit} icon={title.hidden ? <Eye size={20} aria-hidden="true" /> : <EyeSlash size={20} aria-hidden="true" />}
            onClick={() => toggleHidden(title)}>{title.hidden ? 'Показать друзьям' : 'Скрыть от друзей'}</Button>
          <Button variant="danger" className={s.edit} onClick={() => remove(title.id, title.title)}>Удалить</Button>
        </>
      )
      )}>
        {title && (
          <div className={s.content}>
            <img className={s.backdrop} src={cover} alt="" aria-hidden="true" />
            <div className={s.hero}>
              <div className={s.poster}>
                <Cover src={cover} alt="" />
              </div>
              <div className={s.heading}>
                <h2 id="title-sheet-title" className={s.name}>{title.title}</h2>
                {title.originalTitle && title.originalTitle !== title.title && <div className={s.original}>{title.originalTitle}</div>}
                <div className={s.meta}>{meta}</div>
                {isStillAiring(title) && <div className={s.airing}>Всё ещё выходит</div>}
                {cinema && <div className={s.airing}>{cinema}</div>}
                {title.hidden && <div className={s.hiddenNote}><EyeSlash size={14} aria-hidden="true" />Скрыт от друзей</div>}
              </div>
            </div>

            {hasPartsChecklist(title) ? (
              <PartsChecklist parts={title.parts} checked={checked}
                onToggle={(i, on) => store().setPartChecked(title.id, i, on)}
                onAllReleased={() => store().setAllReleasedChecked(title.id)} />
            ) : (
              <>
                {title.status === 'unreleased' && <p className={s.unreleased}>
                  {isSearchCard(title) ? 'Ещё не вышло. Снимем отметку сами, когда выйдет.' : 'Ещё не вышло. Когда выйдет, сними отметку в редактировании.'}
                </p>}
                {title.status !== 'unreleased' && <StatusControl value={title.status} category={title.category} onChange={(st) => store().setStatus(title.id, st)} />}
              </>
            )}

            {title.status !== 'unreleased' && (
              <RatingControl value={title.rating ?? null} prompt={title.status === 'done' && title.rating == null}
                onChange={(v) => store().setRating(title.id, v)} />
            )}

            <FriendsOnTitle title={title} />
            <Synopsis text={title.synopsis} />
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

/** The description; a machine translation (spec 3.3) says so under it. */
export function Synopsis({ text }: { text: string | null | undefined }) {
  const { text: body, machine } = synopsisText(text);
  if (!body) return null;
  return (
    <div className={s.synopsisWrap}>
      <p className={s.synopsis}>{body}</p>
      {machine && <p className={s.mtNote}>Машинный перевод</p>}
    </div>
  );
}
