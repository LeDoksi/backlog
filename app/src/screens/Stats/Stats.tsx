import { useMemo, useState } from 'react';
import { useTitles } from '../../data/titlesStore';
import { comparison, computeStats, defaultPeriod, periodStats, showcase, type Period } from '../../data/stats';
import { Segmented } from '../../ui/Segmented';
import { useIsDesktop } from '../../ui/useMediaQuery';
import { plural } from '../../data/labels';
import { resolveCover } from '../../lib/covers';
import { ASSET_ROOT } from '../../config';
import { EmptyState } from '../../ui/EmptyState';
import { Leaderboard } from './Leaderboard';
import s from './Stats.module.css';

export function Stats() {
  const titles = useTitles((t) => t.titles);
  const checked = useTitles((t) => t.checked);
  const checkedAt = useTitles((t) => t.checkedAt);
  const ticks = (id: string) => checkedAt[id] ?? {};
  const st = useMemo(() => computeStats(titles, (id) => checked[id] ?? []), [titles, checked]);
  const [period, setPeriod] = useState<Period>(() => defaultPeriod(titles, ticks));
  const ps = useMemo(() => periodStats(titles, ticks, period), [titles, checkedAt, period]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxGenre = ps.genres[0]?.count ?? 1;
  const desktop = useIsDesktop();
  // A fresh draw each time the screen opens; it stays put while it is shown
  // and only redraws when the period or the number of finished titles changes.
  const fan = useMemo(() => showcase(ps.finished, desktop ? 10 : 3), [desktop, period, ps.done]); // eslint-disable-line react-hooks/exhaustive-deps
  const versus = comparison(ps, period);

  const tiles = [
    { n: ps.byCategory.movie.done, label: plural(ps.byCategory.movie.done, 'фильм', 'фильма', 'фильмов') },
    { n: ps.byCategory.series.seasons ?? 0, label: plural(ps.byCategory.series.seasons ?? 0, 'сезон сериалов', 'сезона сериалов', 'сезонов сериалов') },
    { n: ps.byCategory.anime.seasons ?? 0, label: plural(ps.byCategory.anime.seasons ?? 0, 'сезон аниме', 'сезона аниме', 'сезонов аниме') },
    { n: ps.byCategory.game.done, label: plural(ps.byCategory.game.done, 'игра', 'игры', 'игр') }
  ];

  return (
    <div className={s.screen}>
      <div className={s.glow} aria-hidden="true" />
      <h1 className={s.h1}>Итоги</h1>
      {st.total === 0 ? (
        <EmptyState title="Пока нечего считать" text="Добавь тайтлы и отмечай просмотренное, здесь появятся итоги." />
      ) : (
        <>
        <div className={s.periods}>
            <Segmented label="Период" value={period} onChange={setPeriod}
              options={[{ value: 'month', label: 'Месяц' }, { value: 'year', label: 'Год' }, { value: 'all', label: 'Всё время' }]} />
          </div>
        <div className={s.layout}>
          <section className={s.hero} aria-label={ps.label}>
            <div className={s.fan} aria-hidden="true">
              {fan.map((t) => <img key={t.id} src={resolveCover(t.cover, ASSET_ROOT)} alt="" />)}
            </div>
            <span className={s.period}>{ps.label}</span>
            <div className={s.big}>
              <span className={s.bigNum}>{ps.done}</span>
              <span className={s.bigText}>{plural(ps.done, 'тайтл', 'тайтла', 'тайтлов')}<br />завершено</span>
            </div>
            <span className={s.sub}>
              {versus ? `${versus}.` : `Из ${st.total} в бэклоге. Смотришь ${st.inProgress}, ждут своей очереди ${st.queue}.`}
              {st.waiting > 0 && ` Ещё ${st.waiting} ${plural(st.waiting, 'ждёт', 'ждут', 'ждут')} новых сезонов.`}
            </span>
          </section>
          <div className={s.tiles}>
            {tiles.map((t) => (
              <div key={t.label} className={s.tile}><span className={s.tileNum}>{t.n}</span><span className={s.tileLabel}>{t.label}</span></div>
            ))}
          </div>
          {ps.genres.length > 0 && (
            <section className={s.card} aria-labelledby="fav-genres">
              <h2 id="fav-genres" className={s.h2}>Любимые жанры</h2>
              <ul className={s.genres}>
                {ps.genres.slice(0, 8).map((g) => (
                  <li key={g.genre} className={s.genre}>
                    <span className={s.genreName}>{g.genre}</span>
                    <span className={s.genreBar}><span style={{ transform: `scaleX(${g.count / maxGenre})` }} /></span>
                    <span className={s.genreCount}>{g.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Leaderboard period={period} />
        </div>
        </>
      )}
    </div>
  );
}
