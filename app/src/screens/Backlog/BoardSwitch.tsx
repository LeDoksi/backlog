import { useBoards } from '../../data/boardsStore';
import { Avatar } from '../../ui/Avatar';
import s from './BoardSwitch.module.css';

// Shown only when there is a second board to switch to; filters stay as
// they are, only the board under them changes.
export function BoardSwitch() {
  const boards = useBoards((b) => b.boards);
  const activeId = useBoards((b) => b.activeId);
  const setActive = useBoards((b) => b.setActive);
  const personal = boards.find((b) => b.kind === 'personal');
  const shared = boards.find((b) => b.kind === 'shared');
  if (!personal || !shared) return null;
  return (
    <div role="group" aria-label="Доска" className={s.group}>
      <button type="button" className={s.btn} aria-pressed={activeId === personal.id} onClick={() => setActive(personal.id)}>Моё</button>
      <button type="button" className={[s.btn, s.shared].join(' ')} aria-pressed={activeId === shared.id} onClick={() => setActive(shared.id)}>
        <span className={s.avatars} aria-hidden="true">
          {(shared.members ?? []).slice(0, 3).map((m) => <Avatar key={m.id} userId={m.id} name={m.name} size={22} />)}
        </span>
        Общее
      </button>
    </div>
  );
}
