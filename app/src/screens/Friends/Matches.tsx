import { resolveCover } from '../../lib/covers';
import { ASSET_ROOT } from '../../config';
import { useUi } from '../../data/ui';
import { matchText, tabForStatus } from '../../data/friendsOn';
import type { Match } from '../../lib/social';
import s from './Matches.module.css';

/** One match: a title both of you have in your plans; a tap opens the friend on that shelf. */
export function MatchCard({ match }: { match: Match }) {
  const openFriend = useUi((u) => u.openFriend);
  const text = matchText(match);
  return (
    <button type="button" className={s.card} aria-label={`Совпадение: ${text}`}
      onClick={() => openFriend(match.friend_id, tabForStatus(match.friend_status))}>
      <img className={s.cover} src={resolveCover(match.cover ?? undefined, ASSET_ROOT)} alt="" loading="lazy" decoding="async" />
      <span className={s.text}>
        <span className={s.kicker}>Совпадение</span>
        <span>{text}</span>
      </span>
    </button>
  );
}

export function Matches({ matches }: { matches: Match[] }) {
  return (
    <section className={s.list} aria-label="Совпадения">
      {matches.map((m) => <MatchCard key={`${m.friend_id}:${m.title_key}`} match={m} />)}
    </section>
  );
}
