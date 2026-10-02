import { useEffect, useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import { Sheet } from '../../ui/Sheet';
import { Avatar } from '../../ui/Avatar';
import { Confirm } from '../../ui/Confirm';
import { useUi } from '../../data/ui';
import { useSocial } from '../../data/socialStore';
import { getSupabase } from '../../data/supabase';
import { friendProfile, friendShelf, removeFriend, tasteMatch, type FriendPage, type ShelfItem, type Taste } from '../../lib/social';
import { resolveCover } from '../../lib/covers';
import { ASSET_ROOT } from '../../config';
import type { ShelfTab } from '../../data/feedFormat';
import { TasteCard } from './TasteCard';
import { CopyFromFriend } from './CopyFromFriend';
import s from './FriendProfile.module.css';

const TABS: { value: ShelfTab; label: string }[] = [
  { value: 'done', label: 'Завершено' }, { value: 'watching', label: 'Смотрит' }, { value: 'want', label: 'Хочет' }
];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export function sinceText(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? `в друзьях с ${date}` : `в друзьях с ${date} ${d.getFullYear()}`;
}

export function FriendProfile() {
  const target = useUi((u) => u.friend);
  const close = useUi((u) => u.closeFriend);
  const [page, setPage] = useState<FriendPage | 'none' | null>(null);
  const [taste, setTaste] = useState<Taste | null>(null);
  const [tab, setTab] = useState<ShelfTab>('done');
  const [shelf, setShelf] = useState<ShelfItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [picked, setPicked] = useState<ShelfItem | null>(null);
  const id = target?.id ?? null;

  useEffect(() => {
    if (!target) return;
    setPage(null); setTaste(null); setMenu(false); setFailed(false); setPicked(null); setTab(target.tab);
    const client = getSupabase();
    let live = true;
    void friendProfile(client, target.id).then((p) => { if (!live) return; setPage(p); if (p === null) setFailed(true); });
    void tasteMatch(client, target.id).then((t) => { if (live) setTaste(t); });
    return () => { live = false; };
  }, [target]);

  useEffect(() => {
    if (!id) return;
    setShelf(null);
    let live = true;
    void friendShelf(getSupabase(), id, tab).then((rows) => { if (!live) return; setShelf(rows); if (!rows) setFailed(true); });
    return () => { live = false; };
  }, [id, tab]);

  async function remove() {
    setConfirming(false);
    if (!id) return;
    if (!(await removeFriend(getSupabase(), id))) { setFailed(true); return; }
    void useSocial.getState().loadFriends();
    close();
  }

  const info = page && page !== 'none' ? page : null;
  const title = info?.name ?? 'Профиль';
  return (
    <>
      <Sheet open={!!target} onClose={close} labelledBy="friend-name">
        {info?.is_friend && (
          <div className={s.top}>
            <button type="button" className={s.more} aria-label="Ещё" aria-expanded={menu} onClick={() => setMenu((m) => !m)}><DotsThree size={24} weight="bold" /></button>
          </div>
        )}
        {menu && <div className={s.menu}><button type="button" className={s.remove} onClick={() => setConfirming(true)}>Удалить из друзей</button></div>}
        {failed && <p role="alert" className={s.error}>Не всё загрузилось. Проверь сеть.</p>}
        <div className={s.head}>
          {info && <Avatar userId={info.id} name={info.name} size={84} />}
          <div className={s.who}>
            <h2 id="friend-name" className={s.name}>{page === 'none' ? 'Профиль недоступен' : title}</h2>
            {info && <span className={s.muted}>{[info.nickname && `@${info.nickname}`, info.since && sinceText(info.since)].filter(Boolean).join(', ')}</span>}
          </div>
        </div>
        {info && <TasteCard taste={taste} />}
        {info && (
          <>
            <div className={s.tabs} role="group" aria-label="Полка">
              {TABS.map((t) => (
                <button key={t.value} type="button" aria-pressed={tab === t.value} className={tab === t.value ? `${s.tab} ${s.tabOn}` : s.tab} onClick={() => setTab(t.value)}>{t.label}</button>
              ))}
            </div>
            {shelf && shelf.length === 0 && <p className={s.empty}>Здесь пусто или скрыто настройками приватности.</p>}
            {shelf && shelf.length > 0 && (
              <ul className={s.grid} aria-label={TABS.find((t) => t.value === tab)!.label}>
                {shelf.map((t) => (
                  <li key={t.id}>
                    <button type="button" className={s.item} aria-label={t.title} onClick={() => setPicked(t)}>
                      <div className={s.poster}>
                        <img src={resolveCover(t.cover ?? undefined, ASSET_ROOT)} alt="" loading="lazy" decoding="async" />
                        {t.common && <span className={s.common}>общее</span>}
                      </div>
                      <div className={s.caption}>{t.title}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Sheet>
      {id && <CopyFromFriend owner={id} item={picked} onClose={() => setPicked(null)} />}
      <Confirm open={confirming} danger confirm="Удалить" title={`Удалить ${title} из друзей?`}
        text="Вы перестанете видеть ленту и полки друг друга. Добавиться снова можно в любой момент."
        onCancel={() => setConfirming(false)} onConfirm={() => void remove()} />
    </>
  );
}
