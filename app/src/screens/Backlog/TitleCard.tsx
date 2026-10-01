import { memo, useEffect, useRef, useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import { StatusPill } from '../../ui/StatusPill';
import { useLongPress } from '../../ui/useLongPress';
import { resolveCover } from '../../lib/covers';
import { isStillAiring } from '../../lib/query';
import { ASSET_ROOT } from '../../config';
import { openTitle } from '../../data/ui';
import { cardProgress, metaLine, STATUS_CARD } from '../../data/labels';
import type { Title } from '../../lib/types';
import type { FriendOn } from '../../lib/social';
import { Avatar } from '../../ui/Avatar';
import { statusWord } from '../../data/friendsOn';
import { QuickStatus } from './QuickStatus';
import s from './TitleCard.module.css';

const PLACEHOLDER = resolveCover(undefined, ASSET_ROOT);

export function cardLabel(t: Title, friend?: FriendOn): string {
  return [t.title, STATUS_CARD[t.status], isStillAiring(t) ? 'всё ещё выходит' : '',
    friend ? `${friend.friend_name} ${statusWord(friend.status, t.category)}` : ''].filter(Boolean).join(' — ');
}

/** `friend` is the one friend shown on the card: the first by byPriority. */
interface Props { title: Title; checked: number[] | undefined; friend?: FriendOn; onQuickChange: () => void }

export const TitleCard = memo(function TitleCard({ title, checked, friend, onQuickChange }: Props) {
  const [quick, setQuick] = useState(false);
  const root = useRef<HTMLElement>(null);
  const progress = cardProgress(title, checked);
  const hasQuick = title.status !== 'unreleased' || !!progress;
  const press = useLongPress(() => { if (hasQuick) { navigator.vibrate?.(10); setQuick(true); } });

  useEffect(() => {
    if (!quick) return;
    root.current?.querySelector<HTMLElement>('[role="group"] button')?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setQuick(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setQuick(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [quick]);

  return (
    <article ref={root} className={`bl-card ${s.card}`} data-id={title.id}>
      <div className={s.posterWrap}>
        {/* No shared poster with the panel: flying it back on close re-projected
            the grid and read as the card reloading under the finger. */}
        <div className={s.poster}>
          <img src={resolveCover(title.cover, ASSET_ROOT)} alt="" loading="lazy" decoding="async" draggable={false}
            onError={(e) => { if (e.currentTarget.src !== PLACEHOLDER) e.currentTarget.src = PLACEHOLDER; }} />
        </div>
        <div className={s.pill}><StatusPill status={title.status} onPoster /></div>
        {progress && (
          <div className={s.progress} aria-hidden="true">
            <div className={s.progressText}><span>{progress.left}</span><span>{progress.right}</span></div>
            <div className={s.bar}><div className={s.fill} style={{ transform: `scaleX(${progress.pct})` }} /></div>
          </div>
        )}
        {hasQuick && <QuickStatus title={title} open={quick} onDone={() => setQuick(false)} onChange={onQuickChange} />}
      </div>
      <div className={s.body}>
        <div className={s.title}>{title.title}</div>
        <div className={s.metaRow}>
          <span className={s.meta}>{metaLine(title)}</span>
          {friend && <span className={s.friend} aria-hidden="true"><Avatar userId={friend.friend_id} name={friend.friend_name} size={18} /><span className={s.friendName}>{friend.friend_name}</span></span>}
        </div>
      </div>
      <button type="button" className={s.hit} aria-label={cardLabel(title, friend)} onClick={() => openTitle(title.id)} {...press} />
      {hasQuick && (
        <button type="button" className={s.more} aria-label={`Быстрые действия: ${title.title}`} aria-expanded={quick}
          onClick={() => setQuick((q) => !q)}><DotsThree size={20} weight="bold" /></button>
      )}
    </article>
  );
});
