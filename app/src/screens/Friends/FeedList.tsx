import { groupFeed, type FeedRow } from '../../data/feedFormat';
import { FeedItem } from './FeedItem';
import s from './Friends.module.css';

interface Props { rows: FeedRow[]; onOpen(row: FeedRow): void; limit?: number }

export function FeedList({ rows, onOpen, limit }: Props) {
  const now = new Date();
  return (
    <>
      {groupFeed(limit ? rows.slice(0, limit) : rows, now).map((g) => (
        <section key={g.label} className={s.group} aria-label={g.label}>
          <h2 className={s.groupTitle}>{g.label}</h2>
          {g.rows.map((r) => <FeedItem key={`${r.kind}:${r.actor_id}:${r.title_id}:${r.at}`} row={r} now={now} onOpen={onOpen} />)}
        </section>
      ))}
    </>
  );
}
