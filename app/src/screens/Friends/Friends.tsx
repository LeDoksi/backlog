import { useEffect, useState } from 'react';
import { UserPlus } from '@phosphor-icons/react';
import { useSocial } from '../../data/socialStore';
import { Skeleton } from '../../ui/Skeleton';
import type { FeedRow } from '../../data/feedFormat';
import { FeedList } from './FeedList';
import { Requests } from './Requests';
import { AddFriendSheet } from './AddFriendSheet';
import s from './Friends.module.css';

export function Friends() {
  const feed = useSocial((st) => st.feed);
  const friends = useSocial((st) => st.friends);
  const failed = useSocial((st) => st.failed);
  const [adding, setAdding] = useState(false);

  useEffect(() => { void useSocial.getState().openFriends(); }, []);

  function open(_row: FeedRow) { /* the friend's profile arrives with it */ }

  return (
    <div className={s.screen}>
      <div className={s.glow} aria-hidden="true" />
      <div className={s.head}>
        <h1 className={s.h1}>Друзья</h1>
        <button type="button" className={s.add} onClick={() => setAdding(true)}><UserPlus size={20} aria-hidden="true" />Добавить</button>
      </div>
      <Requests />
      {failed && <p role="alert" className={s.error}>Не всё загрузилось. Проверь сеть.</p>}
      {feed === null && !failed && <><Skeleton kind="row" /><Skeleton kind="row" /><Skeleton kind="row" /></>}
      {feed && feed.length > 0 && <FeedList rows={feed} onOpen={open} />}
      {feed && feed.length === 0 && (
        <p className={s.note}>{friends && friends.length > 0
          ? 'За две недели у друзей ничего нового. Здесь появится, что они начинают, завершают и добавляют.'
          : 'Здесь будет лента друзей: что они начинают, завершают и добавляют.'}</p>
      )}
      <AddFriendSheet open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
