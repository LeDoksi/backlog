import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Segmented } from '../../src/ui/Segmented';

function Harness() {
  const [v, setV] = useState<'a' | 'b' | 'c'>('a');
  return <Segmented label="Статус" value={v} onChange={setV} options={[{ value: 'a', label: 'В бэклоге' }, { value: 'b', label: 'Смотрю' }, { value: 'c', label: 'Завершено' }]} />;
}

test('click selects and exposes radio semantics', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('radio', { name: 'Смотрю' }));
  expect(screen.getByRole('radio', { name: 'Смотрю' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'В бэклоге' })).toHaveAttribute('aria-checked', 'false');
});

test('arrow keys move the selection', async () => {
  render(<Harness />);
  screen.getByRole('radio', { name: 'В бэклоге' }).focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: 'Смотрю' })).toHaveAttribute('aria-checked', 'true');
  await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
  expect(screen.getByRole('radio', { name: 'Завершено' })).toHaveAttribute('aria-checked', 'true');
});
