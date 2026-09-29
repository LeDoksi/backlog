import type { Taste } from '../../lib/social';
import { plural } from '../../data/labels';
import s from './FriendProfile.module.css';

// Hidden when either side switched matches off (decision: the card simply
// is not there); "too little" is said out loud.
export function TasteCard({ taste }: { taste: Taste | null }) {
  if (!taste || taste.status === 'disabled') return null;
  if (taste.status !== 'ok') {
    return <section className={s.taste} aria-label="Совпадение вкусов"><span className={s.tasteLabel}>Совпадение вкусов</span><span className={s.muted}>Пока мало данных для сравнения</span></section>;
  }
  return (
    <section className={s.taste} aria-label="Совпадение вкусов">
      <div className={s.tasteRow}>
        <div className={s.tasteLeft}>
          <span className={s.tasteLabel}>Совпадение вкусов</span>
          <span className={s.percent}>{taste.percent}%</span>
        </div>
        <div className={s.tasteRight}>
          <span><b>{taste.common}</b> {plural(taste.common, 'общий тайтл', 'общих тайтла', 'общих тайтлов')}</span>
          <span><b>{taste.both_want}</b> хотите оба</span>
        </div>
      </div>
      {taste.genres.length > 0 && (
        <div className={s.genres}>
          <span className={s.tasteLabel}>Общие жанры</span>
          {taste.genres.map((g) => <span key={g} className={s.genre}>{g}</span>)}
        </div>
      )}
    </section>
  );
}
