import { useEffect, useRef, useState } from 'react';
import { ShareFat } from '@phosphor-icons/react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Avatar } from '../../ui/Avatar';
import { getSupabase } from '../../data/supabase';
import { useSocial } from '../../data/socialStore';
import { inviteUrl } from '../../data/inviteLink';
import { createInviteLink, searchUsers, sendFriendRequest, type FoundPerson } from '../../lib/social';
import s from './AddFriendSheet.module.css';

interface Props { open: boolean; onClose(): void }

const SEARCH_DELAY_MS = 300;

function Result({ p, onAdd }: { p: FoundPerson; onAdd(p: FoundPerson): void }) {
  const state = p.is_friend ? 'В друзьях' : p.requested ? 'Заявка отправлена' : null;
  return (
    <li className={s.person}>
      <Avatar userId={p.id} name={p.name} size={42} />
      <span className={s.personText}><span className={s.personName}>{p.name}</span><span className={s.muted}>@{p.nickname}</span></span>
      {state ? <span className={s.done} role="status">{state}</span>
        : <Button size="md" aria-label={`${p.incoming ? 'Принять' : 'Добавить'}: ${p.name}`} onClick={() => onAdd(p)}>{p.incoming ? 'Принять' : 'Добавить'}</Button>}
    </li>
  );
}

export function AddFriendSheet({ open, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [linkFailed, setLinkFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<FoundPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!open) return;
    setLinkFailed(false);
    void createInviteLink(getSupabase()).then((link) => {
      if (link) setUrl(inviteUrl(window.location.origin, import.meta.env.BASE_URL, link.token));
      else setLinkFailed(true);
    });
  }, [open]);

  useEffect(() => {
    const id = ++run.current;
    if (query.trim().replace(/^@/, '').length < 2) { setFound(null); return; }
    const t = window.setTimeout(() => {
      void searchUsers(getSupabase(), query).then((rows) => {
        if (id !== run.current) return;
        setError(rows ? null : 'Поиск не получился. Проверь сеть.');
        setFound(rows);
      });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [query]);

  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
    catch { setError('Не получилось скопировать: выдели ссылку и скопируй вручную.'); }
  }

  async function add(p: FoundPerson) {
    setError(null);
    const status = await sendFriendRequest(getSupabase(), p.id);
    if (!status || status === 'not_found') { setError('Не получилось отправить заявку. Проверь сеть.'); return; }
    const friends = status === 'friends' || status === 'already_friends';
    setFound((rows) => rows?.map((r) => (r.id === p.id ? { ...r, is_friend: friends, requested: !friends, incoming: false } : r)) ?? rows);
    if (friends) { void useSocial.getState().loadFriends(); void useSocial.getState().loadInbox(); }
  }

  return (
    <Sheet open={open} onClose={() => { setQuery(''); setError(null); onClose(); }} labelledBy="add-friend-title">
      <h2 id="add-friend-title" className={s.title}>Добавить друга</h2>
      <section className={s.link} aria-label="Твоя ссылка">
        <div className={s.linkHead}>
          <span className={s.linkTitle}>Твоя ссылка</span>
          <span className={s.linkText}>Кто откроет её и войдёт, получит заявку в друзья от тебя. Если человека ещё нет в Бэклоге, ссылка его пустит. Действует 7 дней.</span>
        </div>
        <div className={s.address}>
          <span className={s.addressText}>{url ? url.replace(/^https?:\/\//, '') : linkFailed ? 'Ссылка не получилась, проверь сеть' : 'Готовим ссылку…'}</span>
          <button type="button" className={s.copy} disabled={!url} onClick={() => void copy()}>{copied ? 'Скопировано' : 'Копировать'}</button>
        </div>
        {canShare && url && (
          <Button size="lg" className={s.share} icon={<ShareFat size={20} aria-hidden="true" />}
            onClick={() => { void navigator.share({ title: 'Бэклог', text: 'Добавь меня в друзья в Бэклоге', url }).catch(() => {}); }}>
            Поделиться ссылкой
          </Button>
        )}
      </section>
      <div className={s.or}>или найди по нику</div>
      <div className={s.field}>
        <label htmlFor="nick-search" className={s.label}>Ник</label>
        <div className={s.input}>
          <span className={s.at} aria-hidden="true">@</span>
          <input id="nick-search" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} enterKeyHint="search"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      {error && <p role="alert" className={s.error}>{error}</p>}
      {found && found.length === 0 && <p className={s.note}>Никого не нашли. Проверь ник или отправь ссылку.</p>}
      {found && found.length > 0 && (
        <ul className={s.results} aria-label="Найдено">{found.map((p) => <Result key={p.id} p={p} onAdd={(x) => void add(x)} />)}</ul>
      )}
    </Sheet>
  );
}
