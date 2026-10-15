import { resolveCover } from '../../src/lib/covers';

test('relative repo paths resolve against the asset root, not the app base', () => {
  expect(resolveCover('images/covers/frieren-2023.jpg', '/backlog/')).toBe('/backlog/images/covers/frieren-2023.jpg');
});
test('absolute and data URLs pass through', () => {
  expect(resolveCover('https://image.tmdb.org/t/p/w500/x.jpg', '/backlog/')).toBe('https://image.tmdb.org/t/p/w500/x.jpg');
  expect(resolveCover('data:image/jpeg;base64,AAA', '/backlog/')).toBe('data:image/jpeg;base64,AAA');
});
test('missing cover falls back to the placeholder', () => {
  expect(resolveCover(undefined, '/backlog/')).toBe('/backlog/images/covers/_placeholder.svg');
  expect(resolveCover('', '/backlog/')).toBe('/backlog/images/covers/_placeholder.svg');
});

import { isLandscapeCover } from '../../src/lib/covers';
import { synopsisText } from '../../src/lib/synopsis';

test('wide game pictures are recognised by address', () => {
  expect(isLandscapeCover('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1086940/48a2fc/header.jpg?t=1777363040')).toBe(true);
  expect(isLandscapeCover('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/capsule_616x353.jpg')).toBe(true);
  expect(isLandscapeCover('https://media.rawg.io/media/games/044/044b2ee023930ca138deda151f40c18c.jpg')).toBe(true);
  expect(isLandscapeCover('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/library_600x900_2x.jpg')).toBe(false);
  expect(isLandscapeCover('https://cdn2.steamgriddb.com/grid/abc.png')).toBe(false);
  expect(isLandscapeCover('https://image.tmdb.org/t/p/w500/x.jpg')).toBe(false);
  expect(isLandscapeCover('images/covers/haven-2020.jpg')).toBe(false);
  expect(isLandscapeCover(undefined)).toBe(false);
});

test('a machine translation is marked, and the mark is not shown', () => {
  expect(synopsisText('[mt] Тёмный триллер.')).toEqual({ text: 'Тёмный триллер.', machine: true });
  expect(synopsisText('Обычное описание.')).toEqual({ text: 'Обычное описание.', machine: false });
  expect(synopsisText(null)).toEqual({ text: '', machine: false });
});
