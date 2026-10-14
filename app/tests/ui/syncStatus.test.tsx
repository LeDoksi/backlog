import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { vi } from 'vitest';
import { SyncStatus, SAVE_GRACE_MS } from '../../src/ui/SyncStatus';
import { useTitles } from '../../src/data/titlesStore';

beforeEach(() => { vi.useFakeTimers(); useTitles.setState({ pending: 0, online: true }); });
afterEach(() => { vi.useRealTimers(); });

test('an edit on its way to the server says nothing', () => {
  render(<SyncStatus />);
  act(() => { useTitles.setState({ pending: 1 }); });
  act(() => { vi.advanceTimersByTime(SAVE_GRACE_MS - 100); });
  act(() => { useTitles.setState({ pending: 0 }); });
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.queryByRole('status')).toBeNull();
});

test('an edit stuck past the grace period is reported', () => {
  render(<SyncStatus />);
  act(() => { useTitles.setState({ pending: 1 }); });
  act(() => { vi.advanceTimersByTime(SAVE_GRACE_MS + 10); });
  expect(screen.getByRole('status')).toHaveTextContent('Не сохранено: 1 правка');
  act(() => { useTitles.setState({ pending: 0 }); });
  expect(screen.queryByRole('status')).toBeNull();
});

test('offline is said at once', () => {
  render(<SyncStatus />);
  act(() => { useTitles.setState({ online: false }); });
  expect(screen.getByRole('status')).toHaveTextContent('Нет сети');
});
