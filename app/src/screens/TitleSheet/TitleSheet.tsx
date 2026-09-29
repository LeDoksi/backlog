import { useEffect, useState } from 'react';
import { Copy, Eye, EyeSlash, PencilSimple, Trash } from '@phosphor-icons/react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Confirm } from '../../ui/Confirm';
import { useTitles } from '../../data/titlesStore';
import { useUi } from '../../data/ui';
import { useBoards } from '../../data/boardsStore';
import { flushQueue } from '../../data/mirror';
import { getSupabase } from '../../data/supabase';
import { copyTitle } from '../../lib/boards';
import { busy } from '../../data/busy';
import { metaLine } from '../../data/labels';
import { hasPartsChecklist } from '../../lib/storage';
import { resolveCover } from '../../lib/covers';
import { isStillAiring } from '../../lib/query';
import { ASSET_ROOT } from '../../config';
import { StatusControl } from './StatusControl';
import { PartsChecklist } from './PartsChecklist';
import { FriendsOnTitle } from './FriendsOnTitle';
import s from './TitleSheet.module.css';

export function TitleSheet() {
  const id = useUi((u) => u.openTitleId);
  const close = useUi((u) => u.closeTitle);
  const openEdit = useUi((u) => u.openEdit);
  const title = useTitles((t) => (id ? t.titles.find((x) => x.id === id) : undefined));
  const checked = useTitles((t) => (id ? t.checked[id] : undefined)) ?? [];
  const store = useTitles.getState;
  const [confirming, setConfirming] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const open = !!id && !!title;
  // The other board, if there is one: copying goes there.
  const target = useBoards((b) => b.boards.find((x) => x.id !== b.activeId) ?? null);
  const fromId = useTitles((t) => t.boardId);
  const targetName = target ? (target.kind === 'personal' ? 'Моё' : 'Общее') : '';

  useEffect(() => { setCopyNote(null); }, [id]);

  async function copy() {
    if (!title || !target || !fromId) return;
    setCopying(true);
    setCopyNote(null);
    // A title added offline has to reach the server before it can be copied.
    await flushQueue();
    const res = await copyTitle(getSupabase(), title.id, fromId, target.id);
    setCopying(false);
    setCopyNote(res.ok ? `Скопировано в «${targetName}»` : res.error === 'duplicate' ? `Уже есть в «${targetName}»`
      : 'Не получилось скопировать. Проверь сеть и попробуй ещё раз.');
    if (res.ok) void useBoards.getState().refresh();
  }

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
          {target && (
            <Button variant="neutral" className={s.iconBtn} aria-label={`Копировать в «${targetName}»`} aria-busy={copying} onClick={() => { if (!copying) void copy(); }}><Copy size={20} /></Button>
          )}
          <Button variant="neutral" className={s.iconBtn} aria-label={title.hidden ? 'Показать друзьям' : 'Скрыть от друзей'} onClick={() => store().editTitle(title.id, { hidden: !title.hidden })}>
            {title.hidden ? <Eye size={20} /> : <EyeSlash size={20} />}
          </Button>
          <Button variant="danger" className={s.iconBtn} aria-label="Удалить тайтл" onClick={() => setConfirming(true)}><Trash size={20} /></Button>
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
                {title.status !== 'unreleased' && <StatusControl value={title.status} onChange={(st) => store().setStatus(title.id, st)} />}
              </>
            )}

            {copyNote && <p role="status" className={s.copyNote}>{copyNote}</p>}
            <FriendsOnTitle title={title} />
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
