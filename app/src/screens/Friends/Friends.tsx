import { useEffect, useState } from 'react';
import { UserPlus } from '@phosphor-icons/react';
import { useSocial } from '../../data/socialStore';
import { Skeleton } from '../../ui/Skeleton';
import { Segmented } from '../../ui/Segmented';
import { useIsDesktop } from '../../ui/useMediaQuery';
import { shelfTabFor, type FeedRow } from '../../data/feedFormat';
import { useUi } from '../../data/ui';
import { FeedList } from './FeedList';
import { Requests } from './Requests';
import { Matches } from './Matches';
import { FriendsList } from './FriendsList';
import { AddFriendSheet } from './AddFriendSheet';
import s from './Friends.module.css';

type Tab = 'feed' | 'matches' | 'friends';

export function Friends() {
  const feed = useSocial((st) => st.feed);
  const friends = useSocial((st) => st.friends);
  const matches = useSocial((st) => st.matches);
  const failed = useSocial((st) => st.failed);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<Tab>('feed');
  const desktop = useIsDesktop();

  useEffect(() => { void useSocial.getState().openFriends(); }, []);

  const openFriend = useUi((u) => u.openFriend);
  const open = (row: FeedRow) => openFriend(row.actor_id, shelfTabFor(row.kind));
  const hasFriends = !!friends && friends.length > 0;

  const feedBlock = (
    <>
      {feed === null && !failed && <><Skeleton kind="row" /><Skeleton kind="row" /><Skeleton kind="row" /></>}
      {feed && feed.length > 0 && <FeedList rows={feed} onOpen={open} />}
      {feed && feed.length === 0 && (
        <p className={s.note}>{hasFriends
          ? 'За две недели у друзей ничего нового. Здесь появится, что они начинают, завершают и добавляют.'
          : 'Здесь будет лента друзей: что они начинают, завершают и добавляют.'}</p>
      )}
    </>
  );
  const matchesBlock = matches && matches.length > 0
    ? <Matches matches={matches} />
    : matches && <p className={s.note}>Совпадений пока нет. Здесь появятся тайтлы, которые вы с другом оба хотите посмотреть или уже смотрите.</p>;
  const friendsBlock = hasFriends
    ? <FriendsList friends={friends} />
    : friends && <p className={s.note}>Друзей пока нет. Нажми «Добавить», чтобы позвать по ссылке или найти по нику.</p>;
  const addButton = <button type="button" className={s.add} onClick={() => setAdding(true)}><UserPlus size={20} aria-hidden="true" />Добавить</button>;
  const error = failed && <p role="alert" className={s.error}>Не всё загрузилось. Проверь сеть.</p>;

  if (desktop) {
    return (
      <div className={`${s.screen} ${s.screenWide}`}>
        <div className={s.glow} aria-hidden="true" />
        <div className={s.deskLayout}>
          <section className={s.deskMain} aria-label="Лента">
            <h1 className={s.h1}>Друзья</h1>
            {error}
            {feedBlock}
          </section>
          <aside className={s.deskAside}>
            <Requests />
            <section className={s.panel} aria-labelledby="friends-panel">
              <div className={s.panelHead}><h2 id="friends-panel" className={s.h2}>Друзья</h2>{addButton}</div>
              {friends === null && !failed ? <Skeleton kind="row" /> : friendsBlock}
            </section>
            {matches && matches.length > 0 && (
              <section className={s.panel} aria-labelledby="matches-panel">
                <h2 id="matches-panel" className={s.h2}>Совпадения</h2>
                <Matches matches={matches} />
              </section>
            )}
          </aside>
        </div>
        <AddFriendSheet open={adding} onClose={() => setAdding(false)} />
      </div>
    );
  }

  const count = (list: unknown[] | null) => (list && list.length > 0 ? ` ${list.length}` : '');
  return (
    <div className={s.screen}>
      <div className={s.glow} aria-hidden="true" />
      <div className={s.head}>
        <h1 className={s.h1}>Друзья</h1>
        {addButton}
      </div>
      <Segmented label="Раздел" value={tab} onChange={setTab} tone="inverse" options={[
        { value: 'feed', label: 'Лента' },
        { value: 'matches', label: `Совпадения${count(matches)}` },
        { value: 'friends', label: `Друзья${count(friends)}` }
      ]} />
      <Requests />
      {error}
      {tab === 'feed' && feedBlock}
      {tab === 'matches' && matchesBlock}
      {tab === 'friends' && friendsBlock}
      <AddFriendSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
