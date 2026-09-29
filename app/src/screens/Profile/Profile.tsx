import { useEffect, useState } from 'react';
import { CaretRight, EnvelopeSimple, EyeSlash, LinkSimple, LockSimple, Plus, SignOut } from '@phosphor-icons/react';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Segmented';
import { Confirm } from '../../ui/Confirm';
import { readTheme, setTheme, type ThemePref } from '../../design/theme';
import { useTitles } from '../../data/titlesStore';
import { useBoards } from '../../data/boardsStore';
import { getSupabase } from '../../data/supabase';
import { plural } from '../../data/labels';
import * as Auth from '../../lib/auth';
import { InviteSheet } from './InviteSheet';
import { NickInviteSheet } from './NickInviteSheet';
import { MembersSheet } from './MembersSheet';
import { EditProfileSheet } from './EditProfileSheet';
import { Privacy } from '../Privacy/Privacy';
import { useUi } from '../../data/ui';
import { HiddenTitles } from '../Privacy/HiddenTitles';
import { myHiddenTitles } from '../../lib/social';
import { boardLine, boardName } from './boardTexts';
import { AddFriendSheet } from '../Friends/AddFriendSheet';
import s from './Profile.module.css';

interface Props { profile: Auth.Profile; onProfile(p: Auth.Profile): void; onSignOut(): void }

type Panel = 'email' | 'link' | 'nick' | 'members' | 'edit' | 'privacy' | 'hidden' | null;

export function Profile({ profile, onProfile, onSignOut }: Props) {
  const [theme, setThemeState] = useState<ThemePref>(readTheme);
  const [panel, setPanel] = useState<Panel>(null);
  const privacyRequested = useUi((u) => u.privacyRequested);
  useEffect(() => {
    if (!privacyRequested) return;
    useUi.getState().clearPrivacyRequest();
    setPanel('privacy');
  }, [privacyRequested]);
  const [leaving, setLeaving] = useState(false);
  const boards = useBoards((b) => b.boards);
  const pending = useTitles((t) => t.pending);
  const userId = profile.id;
  const name = profile.display_name || profile.email.split('@')[0] || profile.email;
  const personal = boards.find((b) => b.kind === 'personal') ?? null;
  const shared = boards.find((b) => b.kind === 'shared') ?? null;
  const refresh = () => { void useBoards.getState().refresh(); };

  const [hiddenCount, setHiddenCount] = useState<number | null>(null);

  // Counts on the cards come from the server; the board list is re-read
  // each time the profile opens so they match what was just added.
  useEffect(refresh, []);
  useEffect(() => { void myHiddenTitles(getSupabase()).then((r) => { if (r) setHiddenCount(r.length); }); }, []);

  function changeTheme(v: ThemePref) {
    setTheme(v);
    setThemeState(v);
    void Auth.setTheme(getSupabase(), v);
  }

  return (
    <div className={s.screen}>
      <div className={s.glow} aria-hidden="true" style={{ background: `radial-gradient(closest-side, var(--avatar-glow), transparent 70%)` }} />
      <div className={s.head}>
        <Avatar userId={userId} name={name} size={64} />
        <div className={s.who}>
          <h1 className={s.name}>{name}</h1>
          <span className={s.email}>{profile.nickname ? `@${profile.nickname}` : profile.email}</span>
        </div>
        <Button variant="neutral" onClick={() => setPanel('edit')}>Изменить</Button>
      </div>

      <section className={s.card}>
        <h2 className={s.h2}>Доски</h2>
        <div className={s.rows}>
          {personal && (
            <div className={s.board}>
              <div className={s.boardAvatars}><Avatar userId={userId} name={name} size={36} /></div>
              <div className={s.boardText}><span className={s.rowLabel}>{boardName(personal)}</span><span className={s.muted}>{boardLine(personal, userId)}</span></div>
            </div>
          )}
          {shared ? (
            <div className={s.board}>
              <div className={s.boardAvatars}>
                {(shared.members ?? []).slice(0, 3).map((m) => <Avatar key={m.id} userId={m.id} name={m.name} size={36} />)}
              </div>
              <div className={s.boardText}><span className={s.rowLabel}>{boardName(shared)}</span><span className={s.muted}>{boardLine(shared, userId)}</span></div>
              <Button variant="tonal" onClick={() => setPanel('members')}>Участники</Button>
            </div>
          ) : (
            <button type="button" className={s.row} onClick={() => setPanel('nick')}>
              <Plus size={22} aria-hidden="true" /><span className={s.rowLabel}>Создать общую доску</span><CaretRight size={18} aria-hidden="true" />
            </button>
          )}
        </div>
      </section>

      <section className={s.card}>
        <h2 className={s.h2}>Оформление</h2>
        <Segmented label="Тема" value={theme} onChange={changeTheme}
          options={[{ value: 'light', label: 'Светлая' }, { value: 'dark', label: 'Тёмная' }, { value: 'system', label: 'Как в системе' }]} />
      </section>

      <section className={s.card}>
        <button type="button" className={s.row} onClick={() => setPanel('privacy')}>
          <LockSimple size={22} aria-hidden="true" /><span className={s.rowLabel}>Приватность</span><CaretRight size={18} aria-hidden="true" />
        </button>
        <button type="button" className={s.row} onClick={() => setPanel('hidden')}>
          <EyeSlash size={22} aria-hidden="true" /><span className={s.rowLabel}>Скрытые тайтлы</span>
          {hiddenCount !== null && <span className={s.count}>{hiddenCount}</span>}<CaretRight size={18} aria-hidden="true" />
        </button>
        <button type="button" className={s.row} onClick={() => setPanel('link')}>
          <LinkSimple size={22} aria-hidden="true" /><span className={s.rowLabel}>Пригласить в Бэклог</span><CaretRight size={18} aria-hidden="true" />
        </button>
        <button type="button" className={s.row} onClick={() => setPanel('email')}>
          <EnvelopeSimple size={22} aria-hidden="true" /><span className={s.rowLabel}>Пригласить по почте</span><CaretRight size={18} aria-hidden="true" />
        </button>
      </section>

      <button type="button" className={s.signOut} onClick={() => setLeaving(true)}><SignOut size={20} aria-hidden="true" />Выйти из аккаунта</button>

      <AddFriendSheet open={panel === 'link'} onClose={() => setPanel(null)} />
      <InviteSheet open={panel === 'email'} onClose={() => setPanel(null)} />
      <NickInviteSheet open={panel === 'nick'} creating={!shared} onClose={() => { setPanel(null); refresh(); }} />
      <MembersSheet open={panel === 'members'} board={shared} userId={userId} onClose={() => setPanel(null)} onInvite={() => setPanel('nick')} />
      <Privacy open={panel === 'privacy'} profile={profile} onProfile={onProfile} onClose={() => setPanel(null)} />
      <HiddenTitles open={panel === 'hidden'} onCount={setHiddenCount} onClose={() => setPanel(null)} />
      <EditProfileSheet open={panel === 'edit'} profile={profile} onSaved={onProfile} onClose={() => setPanel(null)} />
      <Confirm open={leaving} title="Выйти из аккаунта?" text={pending
          ? `Ещё не сохранено в облаке: ${pending} ${plural(pending, 'правка', 'правки', 'правок')}. Если выйти без сети, они пропадут.`
          : 'Доски останутся в облаке, войти можно снова в любой момент.'} confirm="Выйти"
        onCancel={() => setLeaving(false)} onConfirm={() => { setLeaving(false); onSignOut(); }} />
    </div>
  );
}
