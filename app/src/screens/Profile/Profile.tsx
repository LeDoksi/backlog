import { useState } from 'react';
import { CaretRight, EnvelopeSimple, SignOut, UsersThree } from '@phosphor-icons/react';
import { Avatar } from '../../ui/Avatar';
import { Segmented } from '../../ui/Segmented';
import { Confirm } from '../../ui/Confirm';
import { readTheme, setTheme, type ThemePref } from '../../design/theme';
import { useTitles } from '../../data/titlesStore';
import { plural } from '../../data/labels';
import { InviteSheet } from './InviteSheet';
import { MembersSheet } from './MembersSheet';
import s from './Profile.module.css';

interface Props { userId: string; email: string; onSignOut: () => void }

export function Profile({ userId, email, onSignOut }: Props) {
  const [theme, setThemeState] = useState<ThemePref>(readTheme);
  const [panel, setPanel] = useState<'invite' | 'members' | null>(null);
  const [leaving, setLeaving] = useState(false);
  const count = useTitles((t) => t.titles.length);
  const pending = useTitles((t) => t.pending);
  const name = email.split('@')[0] ?? email;

  return (
    <div className={s.screen}>
      <div className={s.glow} aria-hidden="true" style={{ background: `radial-gradient(closest-side, var(--avatar-glow), transparent 70%)` }} />
      <div className={s.head}>
        <Avatar userId={userId} name={name} size={64} />
        <div className={s.who}>
          <h1 className={s.name}>{name}</h1>
          <span className={s.email}>{email}</span>
        </div>
      </div>

      <section className={s.card}>
        <h2 className={s.h2}>Бэклог</h2>
        <p className={s.muted}>{count} {plural(count, 'тайтл', 'тайтла', 'тайтлов')} в твоём пространстве</p>
        <div className={s.rows}>
          <button type="button" className={s.row} onClick={() => setPanel('invite')}>
            <EnvelopeSimple size={22} aria-hidden="true" /><span className={s.rowLabel}>Пригласить по email</span><CaretRight size={18} aria-hidden="true" />
          </button>
          <button type="button" className={s.row} onClick={() => setPanel('members')}>
            <UsersThree size={22} aria-hidden="true" /><span className={s.rowLabel}>Участники</span><CaretRight size={18} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className={s.card}>
        <h2 className={s.h2}>Оформление</h2>
        <Segmented label="Тема" value={theme} onChange={(v) => { setTheme(v); setThemeState(v); }}
          options={[{ value: 'light', label: 'Светлая' }, { value: 'dark', label: 'Тёмная' }, { value: 'system', label: 'Как в системе' }]} />
      </section>

      <button type="button" className={s.signOut} onClick={() => setLeaving(true)}><SignOut size={20} aria-hidden="true" />Выйти из аккаунта</button>

      <InviteSheet open={panel === 'invite'} onClose={() => setPanel(null)} />
      <MembersSheet open={panel === 'members'} onClose={() => setPanel(null)} userId={userId} />
      <Confirm open={leaving} title="Выйти из аккаунта?" text={pending
          ? `Ещё не сохранено в облаке: ${pending} ${plural(pending, 'правка', 'правки', 'правок')}. Если выйти без сети, они пропадут.`
          : 'Бэклог останется в облаке, войти можно снова в любой момент.'} confirm="Выйти"
        onCancel={() => setLeaving(false)} onConfirm={() => { setLeaving(false); onSignOut(); }} />
    </div>
  );
}
