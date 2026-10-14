import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { RatingControl } from '../../src/screens/TitleSheet/RatingControl';

test('ten choices; a tap sets, a second tap on the same one clears', async () => {
  const onChange = vi.fn();
  const { rerender } = render(<RatingControl value={null} prompt={false} onChange={onChange} />);
  const group = screen.getByRole('radiogroup', { name: 'Оценка' });
  expect(group).toBeInTheDocument();
  expect(screen.getAllByRole('radio')).toHaveLength(10);
  await userEvent.click(screen.getByRole('radio', { name: '7' }));
  expect(onChange).toHaveBeenLastCalledWith(7);
  rerender(<RatingControl value={7} prompt={false} onChange={onChange} />);
  expect(screen.getByRole('radio', { name: '7' })).toHaveAttribute('aria-checked', 'true');
  await userEvent.click(screen.getByRole('radio', { name: '7' }));
  expect(onChange).toHaveBeenLastCalledWith(null);
});

test('a finished title without a rating asks «Как тебе?»', () => {
  render(<RatingControl value={null} prompt onChange={() => {}} />);
  expect(screen.getByText('Как тебе?')).toBeInTheDocument();
  expect(screen.getByRole('radiogroup', { name: 'Как тебе?' })).toBeInTheDocument();
});
