import { useEffect } from 'react';
import { Avatar } from '../../ui/Avatar';
import { useSocial } from '../../data/socialStore';
import { useUi } from '../../data/ui';
import type { Friend } from '../../lib/social';
import s from './Friends.module.css';

/** Friends with their taste match; each opens the friend's page. */
export function FriendsList({ friends }: { friends: Friend[] }) {
  const taste = useSocial((st) => st.taste);
  const openFriend = useUi((u) => u.openFriend);
  const ids = friends.map((f) => f.id).join(',');
  useEffect(() => { if (ids) void useSocial.getState().loadTaste(ids.split(',')); }, [ids]);

  return (
    <ul className={s.friendList} aria-label="Друзья">
      {friends.map((f) => {
        const t = taste[f.id];
        const percent = t && t.status === 'ok' ? `${t.percent}%` : null;
        return (
          <li key={f.id}>
            <button type="button" className={s.friendRow} onClick={() => openFriend(f.id)}
              aria-label={[f.name, f.nickname ? `@${f.nickname}` : '', percent ? `совпадение вкусов ${percent}` : ''].filter(Boolean).join(', ')}>
              <Avatar userId={f.id} name={f.name} size={40} />
              <span className={s.friendText}>
                <b>{f.name}</b>
                {f.nickname && <span className={s.when}>@{f.nickname}</span>}
              </span>
              {percent && <span className={s.friendMatch}>{percent}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
