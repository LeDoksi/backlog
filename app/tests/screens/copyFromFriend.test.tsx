import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { vi } from 'vitest';
import type { Outcome } from '../../src/lib/boards';

let resolveCopy: (o: Outcome) => void = () => {};
vi.mock('../../src/lib/boards', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/boards')>()),
  copyFromFriend: vi.fn(() => new Promise<Outcome>((r) => { resolveCopy = r; }))
}));
vi.mock('../../src/data/supabase', () => ({ getSupabase: () => ({}) }));

const { CopyFromFriend } = await import('../../src/screens/FriendProfile/CopyFromFriend');
const { useBoards } = await import('../../src/data/boardsStore');

const item = (id: string, title: string) => ({ id, title, category: 'movie', year: 2020, cover: null, common: false });

test('an answer for the previous title does not land under the next one', async () => {
  useBoards.setState({ boards: [{ id: 'b1', kind: 'personal', visibility: 'private', title_count: 0, members: null }] });
  const { rerender } = render(<CopyFromFriend owner="u2" item={item('a', 'Прибытие')} onClose={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: 'Добавить к себе' }));
  rerender(<CopyFromFriend owner="u2" item={item('b', 'Драйв')} onClose={() => {}} />);
  await act(async () => { resolveCopy({ ok: true, error: null }); });
  expect(screen.getByRole('dialog', { name: 'Драйв' })).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Добавить к себе' })).not.toHaveAttribute('aria-busy', 'true');
});
