import { useEffect, useState } from 'react';
import { CaretRight, EyeSlash, Info, LockSimple, Plus, SignOut, Sparkle, Trash, UserPlus } from '@phosphor-icons/react';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { Segmented } from '../../ui/Segmented';
import { Switch } from '../../ui/Switch';
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
import { HiddenTitles } from '../Privacy/HiddenTitles';
import { myHiddenTitles } from '../../lib/social';
import { boardLine, boardName } from './boardTexts';
import { DeleteAccountSheet } from './DeleteAccountSheet';
import { DataInfo } from '../DataInfo';
import { WhatsNewSheet } from './WhatsNewSheet';
import { hasUnreadWhatsNew, latestWhatsNew } from '../../data/whatsNew';
import { setShowOther } from '../../lib/otherApi';
import { useUi } from '../../data/ui';
import s from './Profile.module.css';

interface Props { profile: Auth.Profile; onProfile(p: Auth.Profile): void; onSignOut(): void; onDeleted(): void }

type Panel = 'invite' | 'nick' | 'members' | 'edit' | 'privacy' | 'hidden' | 'data' | 'delete' | 'whatsNew' | null;

export function Profile({ profile, onProfile, onSignOut, onDeleted }: Props) {
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

  const unread = hasUnreadWhatsNew(profile.whats_new_seen_at);
  // The dot goes out at once; if the mark does not reach the server
  // (offline), it lights again on the next start, which is harmless.
  function openWhatsNew() {
    setPanel('whatsNew');
    const latest = latestWhatsNew();
    if (!unread || !latest) return;
    onProfile({ ...profile, whats_new_seen_at: latest });
    void Auth.markWhatsNewSeen(getSupabase(), latest);
  }

  // Shown at once; if the server does not take it, it goes back with a note.
  async function changeShowOther(on: boolean) {
    onProfile({ ...profile, show_other: on });
    if (await setShowOther(getSupabase(), on)) return;
    onProfile({ ...profile, show_other: !on });
    useUi.getState().showToast('Не получилось сохранить. Проверь сеть и попробуй ещё раз.');
  }

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
        <div className={s.switchBox}>
          <Switch label="Вкладка «Другое»" hint="Книги, рестораны, спектакли: всё, чего нет в поиске. Видно только на твоих досках"
            checked={!!profile.show_other} onChange={(on) => void changeShowOther(on)} />
        </div>
      </section>

      <section className={s.card}>
        <button type="button" className={s.row} aria-label={unread ? 'Что нового, есть новое' : undefined} onClick={openWhatsNew}>
          <Sparkle size={22} aria-hidden="true" /><span className={s.rowLabel}>Что нового</span>
          {unread && <span className={s.dot} aria-hidden="true" />}
          <CaretRight size={18} aria-hidden="true" />
        </button>
        <button type="button" className={s.row} onClick={() => setPanel('privacy')}>
          <LockSimple size={22} aria-hidden="true" /><span className={s.rowLabel}>Приватность</span><CaretRight size={18} aria-hidden="true" />
        </button>
        {hiddenCount !== null && hiddenCount > 0 && (
          <button type="button" className={s.row} onClick={() => setPanel('hidden')}>
            <EyeSlash size={22} aria-hidden="true" /><span className={s.rowLabel}>Скрытые тайтлы</span>
            <span className={s.count}>{hiddenCount}</span><CaretRight size={18} aria-hidden="true" />
          </button>
        )}
        {profile.is_admin && (
          <button type="button" className={s.row} onClick={() => setPanel('invite')}>
            <UserPlus size={22} aria-hidden="true" /><span className={s.rowLabel}>Пригласить в Бэклог</span><CaretRight size={18} aria-hidden="true" />
          </button>
        )}
      </section>

      <section className={s.card}>
        <h2 className={s.h2}>Данные и аккаунт</h2>
        <div className={s.rows}>
          <button type="button" className={s.row} onClick={() => setPanel('data')}>
            <Info size={22} aria-hidden="true" /><span className={s.rowLabel}>Как мы используем данные</span><CaretRight size={18} aria-hidden="true" />
          </button>
          <button type="button" className={s.row} onClick={() => setPanel('delete')}>
            <Trash size={22} aria-hidden="true" /><span className={s.rowLabel}>Удалить аккаунт</span><CaretRight size={18} aria-hidden="true" />
          </button>
        </div>
      </section>

      <button type="button" className={s.signOut} onClick={() => setLeaving(true)}><SignOut size={20} aria-hidden="true" />Выйти из аккаунта</button>

      {profile.is_admin && <InviteSheet open={panel === 'invite'} onClose={() => setPanel(null)} />}
      <WhatsNewSheet open={panel === 'whatsNew'} onClose={() => setPanel(null)} />
      <DataInfo open={panel === 'data'} onClose={() => setPanel(null)} />
      <DeleteAccountSheet open={panel === 'delete'} nickname={profile.nickname} onClose={() => setPanel(null)} onDeleted={onDeleted} />
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
