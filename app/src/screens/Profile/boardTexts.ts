import type { BoardMember, BoardRow } from '../../lib/auth';
import { plural } from '../../data/labels';

export function boardName(b: BoardRow): string {
  return b.kind === 'personal' ? 'Моё' : 'Общее';
}

export function otherMembers(b: BoardRow, userId: string): BoardMember[] {
  return (b.members ?? []).filter((m) => m.id !== userId);
}

const VISIBILITY_LINE: Record<string, string> = { private: 'видно только мне', friends: 'видят друзья', everyone: 'видят все в Бэклоге' };

// Names are listed as they are, not declined: "с Дашей" would need a guess
// at the name's case forms.
export function boardLine(b: BoardRow, userId: string): string {
  const count = `${b.title_count} ${plural(b.title_count, 'тайтл', 'тайтла', 'тайтлов')}`;
  if (b.kind === 'personal') return `${count}, ${VISIBILITY_LINE[b.visibility] ?? VISIBILITY_LINE.private}`;
  const names = otherMembers(b, userId).map((m) => m.name);
  return names.length ? `${count}, вместе с: ${names.join(', ')}` : `${count}, пока только ты`;
}

export function boardErrorText(code: string | null, nick: string): string {
  switch (code) {
    case 'target_has_shared': return `У @${nick} уже есть другая общая доска`;
    case 'already_member': return `@${nick} уже в твоей общей доске`;
    case 'cannot_invite_self': return 'Себя пригласить нельзя';
    case 'not_found': return `Не нашли @${nick}`;
    default:
      if (code?.startsWith('board_limit')) return 'У тебя уже есть общая доска';
      return 'Не получилось. Проверь сеть и попробуй ещё раз.';
  }
}
