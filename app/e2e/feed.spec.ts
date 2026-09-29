import { test, expect, type Page } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';

const rpcNames = (page: Page) => page.evaluate(() => (window as unknown as { __rpcCalls: { name: string }[] }).__rpcCalls.map((c) => c.name));
const nav = (page: Page) => page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true });
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const daysAgo = (d: number) => { const t = new Date(); t.setDate(t.getDate() - d); t.setHours(12, 0, 0, 0); return t.toISOString(); };
const lesha = '00000000-0000-4000-8000-0000000000e1';
const dasha = '00000000-0000-4000-8000-0000000000d1';
const base = { workspace_id: 'w', cover: null, covers: null, on_shared_board: false };
const feed = [
  { ...base, actor_id: dasha, actor_name: 'Даша', kind: 'parts', title_id: 'frieren-2023', title: 'Фрирен', category: 'anime', count: 2, at: ago(1), on_shared_board: true },
  { ...base, actor_id: lesha, actor_name: 'Лёша', kind: 'added', title_id: 'x', title: 'X', category: 'movie', count: 12, covers: Array(12).fill('images/covers/drive-2011.jpg'), at: ago(2) },
  { ...base, actor_id: lesha, actor_name: 'Лёша', kind: 'completed', title_id: 'drive-2011', title: 'Драйв', category: 'movie', count: 1, at: daysAgo(2) },
  { ...base, actor_id: dasha, actor_name: 'Даша', kind: 'started', title_id: 'ted-lasso-2020', title: 'Тед Лассо', category: 'series', count: 1, at: daysAgo(10) }
];

test('the badge counts new lines, the tab groups them and opening it clears the badge', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, feed });
  await page.goto('./');
  const friendsTab = nav(page).getByRole('button', { name: /Друзья/ });
  await expect(friendsTab).toContainText('4');
  await friendsTab.click();
  await expect(page.getByRole('heading', { name: 'Друзья', level: 1 })).toBeVisible();
  const today = page.getByRole('region', { name: 'Сегодня' });
  await expect(today.getByRole('button')).toHaveCount(2);
  await expect(today).toContainText('Даша · 2 сезона «Фрирен»');
  await expect(today).toContainText('общая доска');
  await expect(today).toContainText('Лёша · +12 тайтлов');
  await expect(page.getByRole('region', { name: 'На этой неделе' })).toContainText('Лёша · завершено «Драйв»');
  await expect(page.getByRole('region', { name: 'Раньше' })).toContainText('Даша · начато «Тед Лассо»');
  expect(await rpcNames(page)).toContain('mark_feed_seen');
  await nav(page).getByRole('button', { name: /Бэклог/ }).click();
  await expect(nav(page).getByRole('button', { name: /Друзья/ })).not.toContainText(/\d/);
});

test('an empty feed says what will appear there', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true });
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  await expect(page.getByText('Здесь будет лента друзей', { exact: false })).toBeVisible();
});
