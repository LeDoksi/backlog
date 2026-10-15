import { fireEvent, render } from '@testing-library/react';
import { Cover } from '../../src/ui/Cover';

const HEADER = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/header.jpg';

test('a wide game picture is shown whole on a blur of itself', () => {
  const { container } = render(<Cover src={HEADER} alt="" />);
  const imgs = container.querySelectorAll('img');
  expect(imgs).toHaveLength(2);
  expect(imgs[0]!.getAttribute('aria-hidden')).toBe('true');
  expect(container.firstElementChild!.className).toMatch(/landscape/);
});

test('a tall poster is one plain image', () => {
  const { container } = render(<Cover src="https://image.tmdb.org/t/p/w500/x.jpg" alt="" />);
  expect(container.querySelectorAll('img')).toHaveLength(1);
  expect(container.firstElementChild!.className).not.toMatch(/landscape/);
});

test('an unknown picture that loads wide switches to the fitted view', () => {
  const { container } = render(<Cover src="https://example.com/a.jpg" alt="" />);
  const img = container.querySelector('img')!;
  Object.defineProperty(img, 'naturalWidth', { value: 460 });
  Object.defineProperty(img, 'naturalHeight', { value: 215 });
  fireEvent.load(img);
  expect(container.querySelectorAll('img')).toHaveLength(2);
});
