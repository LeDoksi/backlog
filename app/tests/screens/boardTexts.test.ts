import { describe, expect, it } from 'vitest';
import { boardErrorText, boardLine, boardName, otherMembers } from '../../src/screens/Profile/boardTexts';
import type { BoardRow } from '../../src/lib/auth';

const me = 'u1';
const shared: BoardRow = {
  id: 'b2', kind: 'shared', visibility: 'private', title_count: 213,
  members: [{ id: 'u1', name: 'Георгий', nickname: 'ledoksi' }, { id: 'u2', name: 'Даша', nickname: 'dasha' }]
};
const personal: BoardRow = { id: 'b1', kind: 'personal', visibility: 'private', title_count: 1, members: [{ id: 'u1', name: 'Георгий', nickname: 'ledoksi' }] };

describe('board texts', () => {
  it('names boards the way the switch does', () => {
    expect(boardName(personal)).toBe('Моё');
    expect(boardName(shared)).toBe('Общее');
  });

  it('counts titles and says who sees the board', () => {
    expect(boardLine(personal, me)).toBe('1 тайтл, видно только мне');
    expect(boardLine(shared, me)).toBe('213 тайтлов, вместе с: Даша');
  });

  it('lists members other than me', () => {
    expect(otherMembers(shared, me).map((m) => m.id)).toEqual(['u2']);
    expect(otherMembers(personal, me)).toEqual([]);
  });

  it('translates server reasons', () => {
    expect(boardErrorText('target_has_shared', 'dasha')).toBe('У @dasha уже есть другая общая доска');
    expect(boardErrorText('already_member', 'dasha')).toBe('@dasha уже в твоей общей доске');
    expect(boardErrorText('cannot_invite_self', 'me')).toBe('Себя пригласить нельзя');
    expect(boardErrorText('not_found', 'x')).toBe('Не нашли @x');
    expect(boardErrorText('board_limit', 'x')).toBe('У тебя уже есть общая доска');
    expect(boardErrorText('Failed to fetch', 'x')).toBe('Не получилось. Проверь сеть и попробуй ещё раз.');
  });
});
