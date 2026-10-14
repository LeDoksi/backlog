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

const { CopyButtons } = await import('../../src/screens/FriendProfile/CopyFromFriend');
const { useBoards } = await import('../../src/data/boardsStore');

test('an answer for the previous title does not land under the next one', async () => {
  useBoards.setState({ boards: [{ id: 'b1', kind: 'personal', visibility: 'private', title_count: 0, members: null }] });
  const { rerender } = render(<CopyButtons owner="u2" id="a" />);
  await userEvent.click(screen.getByRole('button', { name: 'Добавить к себе' }));
  rerender(<CopyButtons owner="u2" id="b" />);
  await act(async () => { resolveCopy({ ok: true, error: null }); });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Добавить к себе' })).not.toHaveAttribute('aria-busy', 'true');
});
