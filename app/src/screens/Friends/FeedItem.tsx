import { Avatar } from '../../ui/Avatar';
import { resolveCover } from '../../lib/covers';
import { ASSET_ROOT } from '../../config';
import { useUi } from '../../data/ui';
import { feedText, feedWhen, shelfTabFor, type FeedRow } from '../../data/feedFormat';
import s from './Friends.module.css';

/** `compact`: a plain line with no card, for the desktop column. */
interface Props { row: FeedRow; now: Date; compact?: boolean }

// A tap on the line opens the title (spec 1.1); the name and the avatar open
// the friend. An additions line of several titles opens each cover's title,
// and the rest of it the friend's «Хочет» shelf.
export function FeedItem({ row, now, compact }: Props) {
  const openFriend = useUi((u) => u.openFriend);
  const openFriendTitle = useUi((u) => u.openFriendTitle);
  const text = feedText(row);
  const when = feedWhen(row.at, now) + (row.on_shared_board ? ', общая доска' : '');
  const strip = !compact && row.kind === 'added' && row.count > 1 ? (row.covers ?? []).slice(0, 8) : null;
  const toFriend = () => openFriend(row.actor_id, shelfTabFor(row.kind));
  const toTitle = (id: string) => openFriendTitle(row.actor_id, id, row.actor_name);
  const many = row.kind === 'added' && row.count > 1;
  const main = many ? toFriend : () => toTitle(row.title_id);
  return (
    <div className={compact ? s.itemCompact : s.item}>
      <button type="button" className={s.lineBtn} onClick={main} aria-label={`${row.actor_name} · ${text}, ${when}`} />
      <div className={s.itemRow}>
        <button type="button" className={s.avatarBtn} tabIndex={-1} aria-hidden="true" onClick={toFriend}>
          <Avatar userId={row.actor_id} name={row.actor_name} size={compact ? 38 : 40} />
        </button>
        <div className={s.itemText}>
          <span className={s.line}>
            <button type="button" className={s.nameBtn} onClick={toFriend}>{row.actor_name}</button>
            {' · '}{text}
          </span>
          <span className={s.when}>{when}</span>
        </div>
        {!strip && <img className={s.cover} src={resolveCover(row.cover ?? undefined, ASSET_ROOT)} alt="" loading="lazy" decoding="async" />}
      </div>
      {strip && strip.length > 0 && (
        <div className={s.strip}>
          {strip.map((c, i) => {
            const id = row.title_ids?.[i];
            const img = <img src={resolveCover(c, ASSET_ROOT)} alt="" loading="lazy" decoding="async" />;
            return id
              ? <button key={i} type="button" className={s.stripBtn} aria-label={`Обложка ${i + 1} из ${strip.length}`} onClick={() => toTitle(id)}>{img}</button>
              : <span key={i} className={s.stripBtn}>{img}</span>;
          })}
        </div>
      )}
    </div>
  );
}
