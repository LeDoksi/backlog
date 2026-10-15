import { useEffect, useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { useUi } from '../../data/ui';
import { useTitles } from '../../data/titlesStore';
import { getSupabase } from '../../data/supabase';
import { friendTitle, type FriendTitleData } from '../../lib/social';
import { CATEGORY_LABEL } from '../../data/labels';
import { statusWord } from '../../data/friendsOn';
import { resolveCover } from '../../lib/covers';
import { Cover } from '../../ui/Cover';
import { ASSET_ROOT } from '../../config';
import type { Category } from '../../lib/types';
import { PartsChecklist } from '../TitleSheet/PartsChecklist';
import { CopyButtons } from '../FriendProfile/CopyFromFriend';
import { canonicalGenres, canonicalPlatforms } from '../../lib/gameNames';
import { Synopsis } from '../TitleSheet/TitleSheet';
import t from '../TitleSheet/TitleSheet.module.css';
import s from './FriendTitle.module.css';

/** «Вадим · завершено, оценка 9/10». */
export function friendStatusLine(name: string, d: Pick<FriendTitleData, 'status' | 'category' | 'rating'>): string {
  const base = `${name} · ${statusWord(d.status, d.category)}`;
  return d.rating ? `${base}, оценка ${d.rating}/10` : base;
}

/** A friend's title, read-only, with «Добавить к себе» (spec 1.3). */
export function FriendTitle() {
  const target = useUi((u) => u.friendTitle);
  const close = useUi((u) => u.closeFriendTitle);
  const openTitle = useUi((u) => u.openTitle);
  const [data, setData] = useState<FriendTitleData | 'none' | null | undefined>(undefined);

  useEffect(() => {
    if (!target) return;
    setData(undefined);
    let live = true;
    void friendTitle(getSupabase(), target.owner, target.id).then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [target]);

  const d = data && data !== 'none' ? data : null;
  // «Открыть мой» only opens a title on the board in front of me.
  const mineHere = useTitles((t) => !!d?.mine_id && t.titles.some((x) => x.id === d.mine_id));
  const cover = resolveCover(d?.cover ?? undefined, ASSET_ROOT);
  const meta = d ? [[CATEGORY_LABEL[d.category as Category], d.year].filter(Boolean).join(', '), (d.category === 'game' ? canonicalGenres(d.genres ?? []) : d.genres ?? []).join(', ')].filter(Boolean).join('. ') : '';
  const parts = d && (d.category === 'series' || d.category === 'anime') && Array.isArray(d.parts) && d.parts.length > 0 ? d.parts : null;

  return (
    <Sheet open={!!target} onClose={close} labelledBy="friend-title-name" footer={target && d && (
      d.mine_id ? (
        <div className={s.mine}>
          <span className={s.have}>{mineHere ? 'Уже у тебя' : 'Уже у тебя на другой доске'}</span>
          {mineHere && <Button variant="inverse" onClick={() => { const id = d.mine_id!; close(); openTitle(id); }}>Открыть мой</Button>}
        </div>
      ) : <div className={s.add}><CopyButtons owner={target.owner} id={target.id} /></div>
    )}>
      {data === undefined && <div className={s.loading} aria-busy="true"><h2 id="friend-title-name" className={t.name}>Загружаю…</h2></div>}
      {data === null && <p role="alert" className={s.error}><span id="friend-title-name">Не загрузилось. Проверь сеть.</span></p>}
      {data === 'none' && (
        <div className={s.gone}>
          <h2 id="friend-title-name" className={t.name}>Тайтл недоступен</h2>
          <p className={s.muted}>Его скрыли от друзей или закрыли доску.</p>
        </div>
      )}
      {d && target && (
        <div className={t.content}>
          <img className={t.backdrop} src={cover} alt="" aria-hidden="true" />
          <div className={t.hero}>
            <div className={t.poster}><Cover src={cover} alt="" /></div>
            <div className={t.heading}>
              <h2 id="friend-title-name" className={t.name}>{d.title}</h2>
              {d.original_title && d.original_title !== d.title && <div className={t.original}>{d.original_title}</div>}
              <div className={t.meta}>{meta}</div>
            </div>
          </div>
          <p className={s.status}>{friendStatusLine(target.name, d)}</p>
          {parts && <PartsChecklist parts={parts} checked={d.checked ?? []} readOnly />}
          <Synopsis text={d.synopsis} />
          {d.category === 'game' && d.platforms && d.platforms.length > 0 && (
            <div className={t.platforms} aria-label="Платформы">{(canonicalPlatforms(d.platforms) ?? []).map((p) => <span key={p} className={t.platform}>{p}</span>)}</div>
          )}
        </div>
      )}
    </Sheet>
  );
}
