import { useEffect, useState } from 'react';
import * as Social from '../../lib/social';
import { getSupabase } from '../../data/supabase';
import { useUi } from '../../data/ui';
import { Avatar } from '../../ui/Avatar';
import { Skeleton } from '../../ui/Skeleton';
import type { Period } from '../../data/stats';
import s from './Stats.module.css';

const TABS = [
  { value: 'movie', label: 'Кино' }, { value: 'series', label: 'Сериалы' },
  { value: 'anime', label: 'Аниме' }, { value: 'game', label: 'Игры' }
] as const;
const HEADING: Record<Period, string> = { month: 'Лидеры месяца', year: 'Лидеры года', all: 'Лидеры за всё время' };

/** Everyone in Backlog who switched it on: top ten, and my own line under it when I am not there. */
export function Leaderboard({ period }: { period: Period }) {
  const [category, setCategory] = useState<(typeof TABS)[number]['value']>('movie');
  const [board, setBoard] = useState<Social.Leaderboard | null | 'loading'>('loading');
  const openPrivacy = useUi((u) => u.openPrivacy);

  useEffect(() => {
    let live = true;
    setBoard('loading');
    void Social.leaderboard(getSupabase(), category, period).then((b) => { if (live) setBoard(b); });
    return () => { live = false; };
  }, [category, period]);

  if (board && board !== 'loading' && board.status === 'off') {
    return (
      <section className={s.card} aria-labelledby="leaders">
        <h2 id="leaders" className={s.h2}>{HEADING[period]}</h2>
        <p className={s.lbNote}>Включи участие в лидерборде в приватности, и здесь появятся лидеры среди всех в Бэклоге.</p>
        <button type="button" className={s.lbLink} onClick={openPrivacy}>Открыть приватность</button>
      </section>
    );
  }

  const me = board && board !== 'loading' && board.status === 'ok' ? board.me : null;
  const rows = board && board !== 'loading' && board.status === 'ok' ? board.rows : [];
  const meListed = rows.some((r) => r.is_me);
  return (
    <section className={s.card} aria-labelledby="leaders">
      <div className={s.lbHead}>
        <h2 id="leaders" className={s.h2}>{HEADING[period]}</h2>
        <span className={s.lbScope}>все в Бэклоге</span>
      </div>
      <div className={s.lbTabs} role="group" aria-label="Категория">
        {TABS.map((t) => (
          <button key={t.value} type="button" className={s.lbTab} aria-pressed={category === t.value} onClick={() => setCategory(t.value)}>{t.label}</button>
        ))}
      </div>
      {board === 'loading' && <><Skeleton kind="row" /><Skeleton kind="row" /></>}
      {board === null && <p role="alert" className={s.lbNote}>Не загрузилось. Проверь сеть.</p>}
      {board !== 'loading' && board !== null && rows.length === 0 && <p className={s.lbNote}>Пока никто ничего не завершил.</p>}
      {rows.length > 0 && (
        <ol className={s.lbList} aria-label="Лидеры">
          {rows.map((r) => (
            <li key={r.user_id} className={`${s.lbRow} ${r.is_me ? s.lbMe : ''}`}>
              <span className={s.lbPlace}>{r.place}</span>
              <Avatar userId={r.user_id} name={r.name} size={32} />
              <span className={s.lbName}>{r.is_me ? 'Ты' : r.name}</span>
              <span className={s.lbScore}>{r.score}</span>
            </li>
          ))}
        </ol>
      )}
      {me && !meListed && rows.length > 0 && (
        <p className={`${s.lbRow} ${s.lbMe}`}>
          <span className={s.lbPlace}>{me.place ?? '—'}</span>
          <span className={s.lbName}>Ты</span>
          <span className={s.lbScore}>{me.score}</span>
        </p>
      )}
      <p className={s.lbHint}>В кино считаем фильмы, в сериалах и аниме сезоны, в играх пройденные игры.</p>
    </section>
  );
}
