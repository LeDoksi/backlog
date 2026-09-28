import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Sheet } from '../../src/ui/Sheet';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Открыть</button>
      <Sheet open={open} onClose={() => setOpen(false)} labelledBy="t">
        <h2 id="t">Жанры</h2>
        <button>Первая</button>
      </Sheet>
    </>
  );
}

test('opens as a labelled modal dialog and closes on Escape, returning focus', async () => {
  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'Открыть' });
  await userEvent.click(opener);
  expect(screen.getByRole('dialog', { name: 'Жанры' })).toHaveAttribute('aria-modal', 'true');
  await userEvent.keyboard('{Escape}');
  // The exit animation keeps the node mounted for a moment.
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(opener).toHaveFocus();
});

test('Tab stays inside the sheet', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Открыть' }));
  await userEvent.tab();
  await userEvent.tab();
  await userEvent.tab();
  expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
});
