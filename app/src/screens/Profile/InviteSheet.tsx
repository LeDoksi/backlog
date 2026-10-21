import { useEffect, useState } from 'react';
import { ShareFat } from '@phosphor-icons/react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Segmented';
import { getSupabase } from '../../data/supabase';
import { inviteUrl } from '../../data/inviteLink';
import * as Auth from '../../lib/auth';
import { adminInvites, createInviteLink, revokeInvite, type AdminInvites } from '../../lib/social';
import s from './Profile.module.css';

type Mode = 'email' | 'link';
const EMAIL = /^\S+@\S+$/;

function until(iso: string | null): string {
  return iso ? 'до ' + new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : 'без срока';
}

// The admin lets someone into the app: by email (30 days) or with a link
// for one person (7 days, optionally only for one Google account). Live
// invites are listed and can be taken back. Boards are joined separately.
export function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<Mode>('email');
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [live, setLive] = useState<AdminInvites | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [revokeFailed, setRevokeFailed] = useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const reload = () => { void adminInvites(getSupabase()).then((r) => { setListFailed(!r); if (r) setLive(r); }); };
  useEffect(() => { if (open) reload(); }, [open]);

  function reset() { setEmail(''); setState('idle'); setUrl(null); setCopied(false); }
  function close() { reset(); setMode('email'); setRevokeFailed(false); onClose(); }

  async function send() {
    const value = email.trim();
    if (mode === 'email' ? !EMAIL.test(value) : value !== '' && !EMAIL.test(value)) { setState('error'); return; }
    setState('sending');
    if (mode === 'email') {
      const res = await Auth.inviteEmail(getSupabase(), value);
      setState(res && res.error ? 'error' : 'sent');
    } else {
      const link = await createInviteLink(getSupabase(), value || null);
      if (link) setUrl(inviteUrl(window.location.origin, import.meta.env.BASE_URL, link.token));
      setState(link ? 'sent' : 'error');
    }
    reload();
  }

  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
    catch { /* the address is on screen to copy by hand */ }
  }

  async function revoke(kind: 'link' | 'email', key: string) {
    const ok = await revokeInvite(getSupabase(), kind, key);
    setRevokeFailed(!ok);
    if (ok) reload();
  }

  const items = live ? [
    ...live.emails.map((e) => ({ kind: 'email' as const, key: e.email, label: e.email, meta: until(e.expires_at) })),
    ...live.links.map((l) => ({ kind: 'link' as const, key: l.token, label: l.email ? `Ссылка для ${l.email}` : 'Ссылка для одного человека', meta: until(l.expires_at) }))
  ] : null;

  return (
    <Sheet open={open} onClose={close} labelledBy="invite-title" footer={
      state === 'sent'
        ? <Button className={s.full} onClick={reset}>{mode === 'email' ? 'Пригласить ещё' : 'Ещё ссылку'}</Button>
        : <Button className={s.full} disabled={state === 'sending'} onClick={() => void send()}>{mode === 'email' ? 'Пригласить' : 'Создать ссылку'}</Button>
    }>
      <h2 id="invite-title" className={s.sheetTitle}>Пригласить в Бэклог</h2>
      <div className={s.stack}>
        <Segmented label="Как пригласить" value={mode} onChange={(m) => { reset(); setMode(m); }}
          options={[{ value: 'email', label: 'По почте' }, { value: 'link', label: 'Ссылкой' }]} />
        {state === 'sent' && mode === 'email' && (
          <p className={s.muted} role="status">Готово. Пусть {email.trim()} войдёт через Google с этой почтой в течение 30 дней.</p>
        )}
        {state === 'sent' && mode === 'link' && url && (
          <section className={s.link} aria-label="Ссылка-приглашение">
            <div className={s.linkHead}>
              <span className={s.linkTitle} role="status">Ссылка готова</span>
              <span className={s.linkText}>{email.trim()
                ? `Пустит только ${email.trim()}, один раз. Действует 7 дней.`
                : 'Пустит одного человека: кто первым войдёт по ней. Действует 7 дней.'}</span>
            </div>
            <div className={s.address}>
              <span className={s.addressText}>{url.replace(/^https?:\/\//, '')}</span>
              <button type="button" className={s.copy} onClick={() => void copy()}>{copied ? 'Скопировано' : 'Копировать'}</button>
            </div>
            {canShare && (
              <Button size="lg" className={s.share} icon={<ShareFat size={20} aria-hidden="true" />}
                onClick={() => { void navigator.share({ title: 'Бэклог', text: 'Приглашение в Бэклог', url }).catch(() => {}); }}>
                Поделиться ссылкой
              </Button>
            )}
          </section>
        )}
        {state !== 'sent' && (
          <form className={s.form} onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <label className={s.field}>
              <span className={s.label}>{mode === 'email' ? 'Почта Google' : 'Почта Google, если ссылка для одного аккаунта'}</span>
              <input className={s.input} type="email" inputMode="email" autoComplete="off" value={email}
                onChange={(e) => { setEmail(e.target.value); if (state === 'error') setState('idle'); }}
                aria-invalid={state === 'error'} aria-describedby={state === 'error' ? 'invite-error' : undefined} />
              {state === 'error' && <span id="invite-error" role="alert" className={s.error}>Не получилось. Проверь адрес и сеть.</span>}
            </label>
            <p className={s.muted}>{mode === 'email'
              ? 'Человек получит доступ к приложению со своей личной доской. Приглашение действует 30 дней.'
              : 'Ссылка пустит одного человека и действует 7 дней. Без почты по ней войдёт тот, кто откроет её первым.'}</p>
          </form>
        )}
      </div>
      <h3 className={s.h3}>Действующие приглашения</h3>
      {revokeFailed && <p role="alert" className={s.error}>Не получилось отозвать. Проверь сеть.</p>}
      {items === null ? <p className={s.muted}>{listFailed ? 'Не получилось загрузить список. Проверь сеть и открой панель снова.' : 'Загружаем…'}</p>
        : items.length === 0 ? <p className={s.muted}>Сейчас нет неиспользованных приглашений.</p>
        : (
          <ul className={s.members} aria-label="Действующие приглашения">
            {items.map((i) => (
              <li key={i.kind + i.key} className={s.member}>
                <span className={s.memberText}><span className={s.memberMail}>{i.label}</span><span className={s.muted}>{i.meta}</span></span>
                <button type="button" className={s.memberAction} aria-label={`Отозвать: ${i.label}`} onClick={() => void revoke(i.kind, i.key)}>Отозвать</button>
              </li>
            ))}
          </ul>
        )}
    </Sheet>
  );
}
