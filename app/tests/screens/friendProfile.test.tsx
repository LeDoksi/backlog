import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { vi } from 'vitest';
import type { FriendPage, Taste } from '../../src/lib/social';

const pages: Record<string, (p: FriendPage) => void> = {};
const tastes: Record<string, (t: Taste) => void> = {};
vi.mock('../../src/lib/social', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/social')>()),
  friendProfile: vi.fn((_c: unknown, id: string) => new Promise<FriendPage>((r) => { pages[id] = r; })),
  tasteMatch: vi.fn((_c: unknown, id: string) => new Promise<Taste>((r) => { tastes[id] = r; })),
  friendShelf: vi.fn(() => Promise.resolve([]))
}));
vi.mock('../../src/data/supabase', () => ({ getSupabase: () => ({}) }));

const { FriendProfile } = await import('../../src/screens/FriendProfile/FriendProfile');
const { useUi } = await import('../../src/data/ui');

const page = (id: string, name: string): FriendPage => ({ id, name, nickname: null, is_friend: true, since: null });

test('a late answer for the previous friend does not land on the next one', async () => {
  render(<FriendProfile />);
  act(() => useUi.getState().openFriend('a'));
  act(() => useUi.getState().openFriend('b'));
  await act(async () => { pages.b!(page('b', 'Даша')); tastes.b!({ status: 'not_enough' }); });
  await act(async () => { pages.a!(page('a', 'Лёша')); tastes.a!({ status: 'ok', percent: 90, common: 3, both_want: 1, genres: [] }); });
  expect(screen.getByRole('heading', { name: 'Даша' })).toBeInTheDocument();
  expect(screen.queryByText(/90/)).not.toBeInTheDocument();
});
