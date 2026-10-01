import { useEffect } from 'react';
import { useSocial } from '../../data/socialStore';
import { useUi } from '../../data/ui';
import { shelfTabFor, type FeedRow } from '../../data/feedFormat';
import { FeedItem } from '../Friends/FeedItem';
import { MatchCard } from '../Friends/Matches';
import s from './FriendsColumn.module.css';

const LINES = 4;

/** Desktop only: the first match and the latest feed lines beside the board. Nothing to show, no column. */
export function FriendsColumn() {
  const feed = useSocial((st) => st.feed);
  const matches = useSocial((st) => st.matches);
  const openFriend = useUi((u) => u.openFriend);
  const setSection = useUi((u) => u.setSection);

  useEffect(() => { void useSocial.getState().loadPeek(); }, []);

  const lines = (feed ?? []).slice(0, LINES);
  const match = matches?.[0];
  if (!match && lines.length === 0) return null;
  const now = new Date();
  const open = (row: FeedRow) => openFriend(row.actor_id, shelfTabFor(row.kind));
  return (
    <aside className={s.column} aria-labelledby="friends-column">
      <div className={s.head}>
        <h2 id="friends-column" className={s.h2}>У друзей</h2>
        <button type="button" className={s.all} onClick={() => setSection('friends')}>Все</button>
      </div>
      {match && <MatchCard match={match} />}
      {lines.map((r) => <FeedItem key={`${r.kind}:${r.actor_id}:${r.title_id}:${r.at}`} row={r} now={now} onOpen={open} compact />)}
    </aside>
  );
}
