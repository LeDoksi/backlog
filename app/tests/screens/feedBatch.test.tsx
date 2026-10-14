import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { vi } from 'vitest';
import type { FriendTitleData } from '../../src/lib/social';

const shelf: Record<string, FriendTitleData | 'none' | null> = {};
vi.mock('../../src/lib/social', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/social')>()),
  friendTitle: vi.fn((_c: unknown, _owner: string, id: string) => Promise.resolve(id in shelf ? shelf[id] : 'none'))
}));
vi.mock('../../src/data/supabase', () => ({ getSupabase: () => ({}) }));

const { FeedBatch } = await import('../../src/screens/FeedBatch/FeedBatch');
const { useUi } = await import('../../src/data/ui');

const base: FriendTitleData = {
  id: '', title: '', original_title: null, category: 'movie', year: 2022, genres: [], synopsis: '', cover: null,
  platforms: null, parts: null, checked: [], status: 'queue', rating: null, title_key: 'k', mine_id: null
};

async function open(ids: string[], count = ids.length) {
  render(<FeedBatch />);
  await act(async () => { useUi.getState().openFeedBatch({ owner: 'u2', name: 'Вадим', ids, count }); });
}

beforeEach(() => {
  for (const k of Object.keys(shelf)) delete shelf[k];
  useUi.setState({ feedBatch: null, friendTitle: null, friend: null });
});

test('lists the titles of an additions line in order, with names', async () => {
  shelf.b = { ...base, id: 'b', title: 'Бэтмен', year: 2022 };
  shelf.d = { ...base, id: 'd', title: 'Драйв', year: 2011 };
  await open(['b', 'd']);
  expect(screen.getByRole('heading', { name: 'Вадим · добавлено 2 тайтла' })).toBeInTheDocument();
  const rows = screen.getAllByRole('button', { name: /^«/ });
  expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['«Бэтмен», Кино, 2022', '«Драйв», Кино, 2011']);
});

test('a tap on a title opens its card over the list', async () => {
  shelf.b = { ...base, id: 'b', title: 'Бэтмен' };
  await open(['b']);
  await userEvent.click(screen.getByRole('button', { name: /«Бэтмен»/ }));
  expect(useUi.getState().friendTitle).toEqual({ owner: 'u2', id: 'b', name: 'Вадим' });
  expect(useUi.getState().feedBatch).not.toBeNull();
});

test('titles no longer visible drop out; the shelf is one tap away', async () => {
  shelf.b = { ...base, id: 'b', title: 'Бэтмен' };
  await open(['b', 'gone'], 5);
  expect(screen.getAllByRole('button', { name: /^«/ })).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: 'Вся полка «Хочет»' }));
  expect(useUi.getState().friend).toEqual({ id: 'u2', tab: 'want' });
  expect(useUi.getState().feedBatch).toBeNull();
});

test('a failed load says so', async () => {
  shelf.b = null;
  await open(['b']);
  expect(screen.getByRole('alert')).toHaveTextContent('Не загрузилось');
});
