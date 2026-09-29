import { Avatar } from '../../ui/Avatar';
import { useSocial } from '../../data/socialStore';
import { useUi } from '../../data/ui';
import { byPriority, statusWord, tabForStatus, titleKey } from '../../data/friendsOn';
import type { Title } from '../../lib/types';
import s from './TitleSheet.module.css';

/** Friends who have this title, read with the board's one request; a tap opens their page over the panel. */
export function FriendsOnTitle({ title }: { title: Title }) {
  const list = useSocial((st) => st.friendsOn[titleKey(title)]);
  const openFriend = useUi((u) => u.openFriend);
  const friends = byPriority(list);
  if (!friends.length) return null;
  return (
    <section className={s.section} aria-labelledby="friends-on-title">
      <h3 id="friends-on-title" className={s.sectionTitle}>У друзей</h3>
      <div className={s.friendChips}>
        {friends.map((f) => (
          <button key={f.friend_id} type="button" className={`${s.friendChip} ${f.status === 'done' ? s.friendChipDone : ''}`}
            onClick={() => openFriend(f.friend_id, tabForStatus(f.status))}>
            <Avatar userId={f.friend_id} name={f.friend_name} size={32} />
            {f.friend_name} · {statusWord(f.status, title.category)}
          </button>
        ))}
      </div>
    </section>
  );
}
