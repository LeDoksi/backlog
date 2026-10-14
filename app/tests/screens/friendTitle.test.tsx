import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { vi } from 'vitest';
import type { FriendTitleData } from '../../src/lib/social';

let answer: FriendTitleData | 'none' | null = null;
vi.mock('../../src/lib/social', async (orig) => ({
  ...(await orig<typeof import('../../src/lib/social')>()),
  friendTitle: vi.fn(() => Promise.resolve(answer))
}));
vi.mock('../../src/data/supabase', () => ({ getSupabase: () => ({}) }));

const { FriendTitle } = await import('../../src/screens/FriendTitle/FriendTitle');
const { useUi } = await import('../../src/data/ui');
const { useBoards } = await import('../../src/data/boardsStore');
const { useTitles } = await import('../../src/data/titlesStore');

const show: FriendTitleData = {
  id: 'ozark', title: 'Озарк', original_title: 'Ozark', category: 'series', year: 2017, genres: ['драма'],
  synopsis: 'Финансист отмывает деньги.', cover: null, platforms: null,
  parts: [{ name: 'Сезон 1' }, { name: 'Сезон 2' }], checked: [0], status: 'done', rating: 9,
  title_key: 'tmdb-tv:69740', mine_id: null
};

async function open(data: FriendTitleData | 'none' | null) {
  answer = data;
  render(<FriendTitle />);
  await act(async () => { useUi.getState().openFriendTitle('u2', 'ozark', 'Вадим'); });
}

beforeEach(() => {
  useUi.setState({ friendTitle: null, openTitleId: null });
  useBoards.setState({ boards: [{ id: 'b1', kind: 'personal', visibility: 'private', title_count: 0, members: null }] });
});

test('shows the friend\'s title read-only with the add button', async () => {
  await open(show);
  expect(screen.getByRole('heading', { name: 'Озарк' })).toBeInTheDocument();
  expect(screen.getByText('Финансист отмывает деньги.')).toBeInTheDocument();
  expect(screen.getByText('Вадим · завершено, оценка 9/10')).toBeInTheDocument();
  const boxes = screen.getAllByRole('checkbox');
  expect(boxes).toHaveLength(2);
  boxes.forEach((b) => expect(b).toBeDisabled());
  expect(boxes[0]).toBeChecked();
  expect(screen.getByRole('button', { name: 'Добавить к себе' })).toBeInTheDocument();
});

test('a title I already have offers mine instead of adding', async () => {
  useTitles.setState({ titles: [{ id: 'ozark-2017', title: 'Озарк', category: 'series', status: 'queue', genres: [] }] });
  await open({ ...show, mine_id: 'ozark-2017' });
  expect(screen.queryByRole('button', { name: 'Добавить к себе' })).not.toBeInTheDocument();
  expect(screen.getByText('Уже у тебя')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Открыть мой' }));
  expect(useUi.getState().openTitleId).toBe('ozark-2017');
  expect(useUi.getState().friendTitle).toBeNull();
});

test('my copy on another board: «Уже у тебя» without a button that would open nothing', async () => {
  useTitles.setState({ titles: [] });
  await open({ ...show, mine_id: 'ozark-2017' });
  expect(screen.getByText('Уже у тебя на другой доске')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Открыть мой' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Добавить к себе' })).not.toBeInTheDocument();
});

test('a title gone from sight says so', async () => {
  await open('none');
  expect(screen.getByRole('heading', { name: 'Тайтл недоступен' })).toBeInTheDocument();
});
