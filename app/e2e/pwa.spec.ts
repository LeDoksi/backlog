import { test, expect } from '@playwright/test';

// v2 lives at the site root (/backlog/) since it replaced v1.
test('the app manifest sits at the site root and its icons load', async ({ request }) => {
  const res = await request.get('/backlog/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest.start_url).toBe('/backlog/');
  expect(manifest.scope).toBe('/backlog/');
  for (const icon of manifest.icons as { src: string }[]) {
    const img = await request.get(new URL(icon.src, 'http://localhost:4173/backlog/manifest.webmanifest').pathname);
    expect(img.status(), icon.src).toBe(200);
    expect(img.headers()['content-type']).toBe('image/png');
  }
});
