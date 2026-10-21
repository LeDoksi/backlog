// BL-118: a card from search has no «Редактировать»; a hand-made card is
// edited by whoever made it.
import { test, expect } from '@playwright/test';
import { E2E_USER, installStub } from './fixtures/supabaseStub';

const base = { category: 'movie', status: 'queue', year: 2021, genres: [], synopsis: 'Текст.', created_at: '2026-01-01T00:00:00Z' };
const titles = [
  { ...base, id: 'dune-2021', title: 'Дюна', source: 'tmdb-movie', source_id: '438631', created_by: E2E_USER },
  { ...base, id: 'mine-2021', title: 'Моё кино', created_by: E2E_USER },
  { ...base, id: 'theirs-2021', title: 'Кино соседа', created_by: '00000000-0000-4000-8000-0000000000ff' },
  { ...base, id: 'old-2021', title: 'Старое кино', created_by: null }
];

async function open(page: import('@playwright/test').Page, name: string) {
  await page.locator('article', { hasText: name }).getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

test('only hand-made cards I made (or nobody did) can be edited', async ({ page }, info) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles });
  await page.goto('./');
  await open(page, 'Дюна');
  await expect(page.getByRole('button', { name: 'Скрыть от друзей' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Удалить' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Редактировать' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('search-card.png') });
  await page.getByRole('button', { name: 'Скрыть от друзей' }).click();
  await expect(page.getByText('Скрыт от друзей')).toBeVisible();
  await page.keyboard.press('Escape');

  await open(page, 'Кино соседа');
  await expect(page.getByRole('button', { name: 'Редактировать' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  for (const name of ['Моё кино', 'Старое кино']) {
    await open(page, name);
    await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible();
    await page.keyboard.press('Escape');
  }
});
