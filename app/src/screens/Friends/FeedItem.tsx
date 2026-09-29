import { Avatar } from '../../ui/Avatar';
import { resolveCover } from '../../lib/covers';
import { ASSET_ROOT } from '../../config';
import { feedText, feedWhen, type FeedRow } from '../../data/feedFormat';
import s from './Friends.module.css';

/** `compact`: a plain line with no card, for the desktop column. */
interface Props { row: FeedRow; now: Date; onOpen(row: FeedRow): void; compact?: boolean }

export function FeedItem({ row, now, onOpen, compact }: Props) {
  const text = feedText(row);
  const when = feedWhen(row.at, now) + (row.on_shared_board ? ', общая доска' : '');
  const strip = !compact && row.kind === 'added' && row.count > 1 ? (row.covers ?? []).slice(0, 8) : null;
  return (
    <button type="button" className={compact ? s.itemCompact : s.item} onClick={() => onOpen(row)} aria-label={`${row.actor_name} · ${text}, ${when}`}>
      <span className={s.itemRow}>
        <Avatar userId={row.actor_id} name={row.actor_name} size={compact ? 38 : 40} />
        <span className={s.itemText}>
          <span><b>{row.actor_name}</b> · {text}</span>
          <span className={s.when}>{when}</span>
        </span>
        {!strip && <img className={s.cover} src={resolveCover(row.cover ?? undefined, ASSET_ROOT)} alt="" loading="lazy" decoding="async" />}
      </span>
      {strip && strip.length > 0 && (
        <span className={s.strip} aria-hidden="true">
          {strip.map((c, i) => <img key={i} src={resolveCover(c, ASSET_ROOT)} alt="" loading="lazy" decoding="async" />)}
        </span>
      )}
    </button>
  );
}
