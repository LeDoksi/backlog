import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Switch } from '../../ui/Switch';
import { useBoards, type Board } from '../../data/boardsStore';
import { getSupabase } from '../../data/supabase';
import { setBoardLeaderboard, setBoardVisibility, setPrivacy, type PrivacySwitches, type Visibility } from '../../lib/social';
import type { Profile } from '../../lib/auth';
import { otherMembers } from '../Profile/boardTexts';
import s from './Privacy.module.css';

interface Props { open: boolean; onClose(): void; profile: Profile; onProfile(p: Profile): void }

const LEVELS: { value: Visibility; label: string }[] = [
  { value: 'private', label: 'Только я' }, { value: 'friends', label: 'Друзья' }, { value: 'everyone', label: 'Все в Бэклоге' }
];
const SWITCHES: { key: keyof PrivacySwitches; label: string; hint: string }[] = [
  { key: 'in_leaderboard', label: 'Лидерборд', hint: 'Показывать мою личную доску в «Лидерах» среди всех в Бэклоге' },
  { key: 'share_activity', label: 'Активность в ленте', hint: 'Друзья видят в ленте, что ты начинаешь и завершаешь' },
  { key: 'share_matches', label: 'Совпадения', hint: 'Считать совпадения вкусов с моей полкой' },
  { key: 'findable_by_nick', label: 'Поиск по нику', hint: 'Меня можно найти по @нику' }
];
const FAILED = 'Не получилось сохранить. Проверь сеть и попробуй ещё раз.';

// Profiles made before these switches existed have no values yet; the
// server defaults are what they mean.
export function switchesOf(p: Profile): PrivacySwitches {
  return {
    in_leaderboard: p.in_leaderboard ?? false,
    share_activity: p.share_activity ?? true,
    share_matches: p.share_matches ?? true,
    findable_by_nick: p.findable_by_nick ?? true
  };
}

function boardTitle(b: Board, userId: string): string {
  if (b.kind === 'personal') return 'Моё';
  const names = otherMembers(b, userId).map((m) => m.name);
  return names.length ? `Общее с: ${names.join(', ')}` : 'Общее';
}

function Levels({ board, userId, onChange, onLeaderboard }: { board: Board; userId: string; onChange(v: Visibility): void; onLeaderboard(on: boolean): void }) {
  const name = boardTitle(board, userId);
  return (
    <div className={s.board}>
      <div className={s.boardHead}>
        <span className={s.boardName}>{name}</span>
        <span className={s.hint}>{board.kind === 'personal' ? 'Личная доска' : 'Менять может любой участник'}</span>
      </div>
      <div role="radiogroup" aria-label={`Кто видит: ${name}`} className={s.levels}>
        {LEVELS.map((l) => (
          <button key={l.value} type="button" role="radio" aria-checked={board.visibility === l.value}
            className={board.visibility === l.value ? `${s.level} ${s.levelOn}` : s.level}
            onClick={() => { if (board.visibility !== l.value) onChange(l.value); }}>
            {l.label}
          </button>
        ))}
      </div>
      {board.kind === 'shared' && (
        <Switch label="Общая доска в лидерах" hint="Отдельной строкой рядом с личными досками"
          checked={board.in_leaderboard ?? false} onChange={onLeaderboard} />
      )}
    </div>
  );
}

export function Privacy({ open, onClose, profile, onProfile }: Props) {
  const boards = useBoards((b) => b.boards);
  const [error, setError] = useState<string | null>(null);
  const switches = switchesOf(profile);

  async function changeLevel(board: Board, visibility: Visibility) {
    setError(null);
    // Shown at once; the board list re-read afterwards is the truth either way.
    useBoards.setState((st) => ({ boards: st.boards.map((b) => (b.id === board.id ? { ...b, visibility } : b)) }));
    const ok = await setBoardVisibility(getSupabase(), board.id, visibility);
    if (!ok) setError(FAILED);
    await useBoards.getState().refresh();
  }

  async function changeLeaderboard(board: Board, on: boolean) {
    setError(null);
    useBoards.setState((st) => ({ boards: st.boards.map((b) => (b.id === board.id ? { ...b, in_leaderboard: on } : b)) }));
    if (!(await setBoardLeaderboard(getSupabase(), board.id, on))) setError(FAILED);
    await useBoards.getState().refresh();
  }

  async function flip(key: keyof PrivacySwitches, value: boolean) {
    setError(null);
    const next = { ...switches, [key]: value };
    onProfile({ ...profile, ...next });
    if (!(await setPrivacy(getSupabase(), next))) {
      setError(FAILED);
      onProfile({ ...profile, ...switches });
    }
  }

  return (
    <Sheet open={open} onClose={() => { setError(null); onClose(); }} labelledBy="privacy-title">
      <h2 id="privacy-title" className={s.title}>Приватность</h2>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <section className={s.section}>
        <h3 className={s.h3}>Кто видит доски</h3>
        {boards.map((b) => <Levels key={b.id} board={b} userId={profile.id} onChange={(v) => void changeLevel(b, v)}
          onLeaderboard={(on) => void changeLeaderboard(b, on)} />)}
      </section>
      <section className={s.section}>
        <h3 className={s.h3}>Участие</h3>
        <div className={s.switches}>
          {SWITCHES.map((sw) => (
            <Switch key={sw.key} label={sw.label} hint={sw.hint} checked={switches[sw.key]} onChange={(v) => void flip(sw.key, v)} />
          ))}
        </div>
        <p className={s.note}>Переключатели действуют в пределах того, кто видит доски: при «Только я» друзья не видят ничего.</p>
      </section>
    </Sheet>
  );
}
