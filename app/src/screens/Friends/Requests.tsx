import { useState } from 'react';
import { X } from '@phosphor-icons/react';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { getSupabase } from '../../data/supabase';
import { useSocial } from '../../data/socialStore';
import { useBoards } from '../../data/boardsStore';
import { respondFriendRequest, type InboxItem } from '../../lib/social';
import { respondBoardInvite } from '../../lib/boards';
import { boardErrorText } from '../Profile/boardTexts';
import s from './Friends.module.css';

type Kind = 'friend' | 'board';

// Everything waiting for an answer, above the feed: friend requests and
// invites into a shared board.
export function Requests() {
  const inbox = useSocial((st) => st.inbox);
  const [error, setError] = useState<string | null>(null);
  if (!inbox) return null;
  const items: { kind: Kind; item: InboxItem }[] = [
    ...inbox.friend_requests.map((item) => ({ kind: 'friend' as const, item })),
    ...inbox.board_invites.map((item) => ({ kind: 'board' as const, item }))
  ];
  if (!items.length) return null;

  async function answer(kind: Kind, item: InboxItem, accept: boolean) {
    setError(null);
    const client = getSupabase();
    if (kind === 'friend') {
      if (!(await respondFriendRequest(client, item.id, accept))) { setError('Не получилось. Проверь сеть и попробуй ещё раз.'); return; }
    } else {
      const res = await respondBoardInvite(client, item.id, accept);
      if (!res.ok) { setError(boardErrorText(res.error, item.nickname ?? '')); return; }
      if (accept) void useBoards.getState().refresh();
    }
    useSocial.setState((st) => ({
      inbox: st.inbox && {
        friend_requests: st.inbox.friend_requests.filter((r) => !(kind === 'friend' && r.id === item.id)),
        board_invites: st.inbox.board_invites.filter((r) => !(kind === 'board' && r.id === item.id))
      },
      badge: Math.max(0, st.badge - 1)
    }));
    if (kind === 'friend' && accept) void useSocial.getState().loadFriends();
  }

  return (
    <section className={s.requests} aria-label="Заявки">
      {items.map(({ kind, item }) => (
        <div key={kind + item.id} className={s.request}>
          <Avatar userId={item.user_id} name={item.name} size={44} />
          <span className={s.requestText}>
            <b>{item.name}</b> {kind === 'friend' ? 'хочет дружить' : 'зовёт в общую доску'}
            {item.nickname && <span className={s.when}>@{item.nickname}</span>}
          </span>
          <button type="button" className={s.decline} aria-label={`Отклонить: ${item.name}`} onClick={() => void answer(kind, item, false)}>
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
          <Button size="md" aria-label={`Принять: ${item.name}`} onClick={() => void answer(kind, item, true)}>Принять</Button>
        </div>
      ))}
      {error && <p role="alert" className={s.error}>{error}</p>}
    </section>
  );
}
