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
