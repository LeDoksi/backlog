import { useMemo } from 'react';
import { useTitles } from '../../data/titlesStore';
import { computeStats } from '../../data/stats';
import { plural } from '../../data/labels';
import { resolveCover } from '../../lib/covers';
import { ASSET_ROOT } from '../../config';
import { EmptyState } from '../../ui/EmptyState';
import s from './Stats.module.css';

export function Stats() {
  const titles = useTitles((t) => t.titles);
  const checked = useTitles((t) => t.checked);
  const st = useMemo(() => computeStats(titles, (id) => checked[id] ?? []), [titles, checked]);
  const maxGenre = st.genres[0]?.count ?? 1;

  const tiles = [
    { n: st.byCategory.movie.done, label: plural(st.byCategory.movie.done, 'фильм', 'фильма', 'фильмов') },
    { n: st.byCategory.series.seasons ?? 0, label: plural(st.byCategory.series.seasons ?? 0, 'сезон сериалов', 'сезона сериалов', 'сезонов сериалов') },
    { n: st.byCategory.anime.seasons ?? 0, label: plural(st.byCategory.anime.seasons ?? 0, 'сезон аниме', 'сезона аниме', 'сезонов аниме') },
    { n: st.byCategory.game.done, label: plural(st.byCategory.game.done, 'игра', 'игры', 'игр') }
  ];

  return (
    <div className={s.screen}>
      <div className={s.glow} aria-hidden="true" />
      <h1 className={s.h1}>Итоги</h1>
      {st.total === 0 ? (
        <EmptyState title="Пока нечего считать" text="Добавь тайтлы и отмечай просмотренное, здесь появятся итоги." />
      ) : (
        <div className={s.layout}>
          <section className={s.hero} aria-label="Всё время">
            <div className={s.fan} aria-hidden="true">
              {st.recentDone.map((t) => <img key={t.id} src={resolveCover(t.cover, ASSET_ROOT)} alt="" />)}
            </div>
            <span className={s.period}>За всё время</span>
            <div className={s.big}>
              <span className={s.bigNum}>{st.done}</span>
              <span className={s.bigText}>{plural(st.done, 'тайтл', 'тайтла', 'тайтлов')}<br />завершено</span>
            </div>
            <span className={s.sub}>
              Из {st.total} в бэклоге. Смотришь {st.inProgress}, ждут своей очереди {st.queue}.
              {st.waiting > 0 && ` Ещё ${st.waiting} ${plural(st.waiting, 'ждёт', 'ждут', 'ждут')} новых сезонов.`}
            </span>
          </section>
          <div className={s.tiles}>
            {tiles.map((t) => (
              <div key={t.label} className={s.tile}><span className={s.tileNum}>{t.n}</span><span className={s.tileLabel}>{t.label}</span></div>
            ))}
          </div>
          {st.genres.length > 0 && (
            <section className={s.card} aria-labelledby="fav-genres">
              <h2 id="fav-genres" className={s.h2}>Любимые жанры</h2>
              <ul className={s.genres}>
                {st.genres.slice(0, 8).map((g) => (
                  <li key={g.genre} className={s.genre}>
                    <span className={s.genreName}>{g.genre}</span>
                    <span className={s.genreBar}><span style={{ transform: `scaleX(${g.count / maxGenre})` }} /></span>
                    <span className={s.genreCount}>{g.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
