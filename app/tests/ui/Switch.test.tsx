import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from '../../src/ui/Switch';

test('toggles through onChange with switch semantics', async () => {
  const onChange = vi.fn();
  render(<Switch checked={false} onChange={onChange} label="Лидерборд" />);
  const sw = screen.getByRole('switch', { name: 'Лидерборд' });
  expect(sw).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(sw);
  expect(onChange).toHaveBeenCalledWith(true);
});
