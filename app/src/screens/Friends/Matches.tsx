import { resolveCover } from '../../lib/covers';
import { ASSET_ROOT } from '../../config';
import { useUi } from '../../data/ui';
import { useTitles } from '../../data/titlesStore';
import { groupMatches, matchGroupText, tabForStatus, titleKey, type MatchGroup } from '../../data/friendsOn';
import { Avatar } from '../../ui/Avatar';
import type { Match } from '../../lib/social';
import s from './Matches.module.css';

const FACES = 3;

/** One title we share, with every friend on it; a tap opens my own card of it (it lists them under «У друзей»). */
export function MatchCard({ group }: { group: MatchGroup }) {
  const openTitle = useUi((u) => u.openTitle);
  const openFriend = useUi((u) => u.openFriend);
  const mine = useTitles((t) => t.titles.find((x) => titleKey(x) === group.title_key)?.id);
  const text = matchGroupText(group);
  const first = group.friends[0];
  const open = () => {
    if (mine) openTitle(mine);
    else if (first) openFriend(first.id, tabForStatus(first.status));
  };
  const more = group.friends.length - FACES;
  return (
    <button type="button" className={s.card} aria-label={`«${group.title}»: ${text}`} onClick={open}>
      <img className={s.cover} src={resolveCover(group.cover ?? undefined, ASSET_ROOT)} alt="" loading="lazy" decoding="async" />
      <span className={s.text}>
        <span className={s.title}>{group.title}</span>
        <span>{text}</span>
        <span className={s.faces} aria-hidden="true">
          {group.friends.slice(0, FACES).map((f) => <Avatar key={f.id} userId={f.id} name={f.name} size={24} />)}
          {more > 0 && <span className={s.more}>+{more}</span>}
        </span>
      </span>
    </button>
  );
}

export function Matches({ matches }: { matches: Match[] }) {
  return (
    <ul className={s.list} aria-label="Совпадения">
      {groupMatches(matches).map((g) => <li key={g.title_key}><MatchCard group={g} /></li>)}
    </ul>
  );
}
