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
  await expect(today.getByRole('button', { name: /^(Даша|Лёша) · / })).toHaveCount(2);
  await expect(today).toContainText('Даша · просмотрено 2 сезона «Фрирен»');
  await expect(today).toContainText('общая доска');
  await expect(today).toContainText('Лёша · добавлено 12 тайтлов');
  await expect(page.getByRole('region', { name: 'На этой неделе' })).toContainText('Лёша · завершено «Драйв»');
  await expect(page.getByRole('region', { name: 'Раньше' })).toContainText('Даша · начато «Тед Лассо»');
  expect(await rpcNames(page)).toContain('mark_feed_seen');
  await nav(page).getByRole('button', { name: /Бэклог/ }).click();
  await expect(nav(page).getByRole('button', { name: /Друзья/ })).not.toContainText(/\d/);
});

const vadim = { id: '00000000-0000-4000-8000-0000000000e2', name: 'Вадим', nickname: 'vadim', since: '2026-08-14T10:00:00Z' };
const long = 'Очень длинное название фильма, которое никак не помещается в одну строку и должно переноситься внутри своей колонки';

test('a long line wraps beside the cover; a tap opens the title, the name opens the friend', async ({ page }) => {
  await installStub(page, {
    signedIn: true, hasProfile: true, friends: [vadim],
    feed: [{ ...base, actor_id: vadim.id, actor_name: 'Вадим', kind: 'completed', title_id: 'long-2020', title: long, category: 'movie', count: 1, cover: 'images/covers/drive-2011.jpg', at: ago(1), rating: 8 }],
    friendTitles: { [`${vadim.id}:long-2020`]: { id: 'long-2020', title: long, original_title: null, category: 'movie', year: 2020, genres: [], synopsis: '', cover: null, platforms: null, parts: null, checked: [], status: 'done', rating: 8, title_key: 'slug:long-2020', mine_id: null } }
  });
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  const line = page.getByRole('button', { name: /^Вадим · завершено/ });
  const today = page.getByRole('region', { name: 'Сегодня' });
  await expect(today).toContainText('8/10');
  const text = (await today.getByText(/Очень длинное/).boundingBox())!;
  const cover = (await page.getByRole('region', { name: 'Сегодня' }).locator('img[src*="drive-2011"]').first().boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(text.x + text.width).toBeLessThanOrEqual(cover.x + 1);
  expect(cover.x + cover.width).toBeLessThanOrEqual(viewport.width);
  await line.click();
  await expect(page.getByRole('dialog', { name: long })).toBeVisible();
  await page.goBack();
  await page.getByRole('button', { name: 'Вадим', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Вадим' })).toBeVisible();
});

test('a cover in an additions line opens that title', async ({ page }) => {
  await installStub(page, {
    signedIn: true, hasProfile: true, friends: [vadim],
    feed: [{ ...base, actor_id: vadim.id, actor_name: 'Вадим', kind: 'added', title_id: 'a', title: 'A', category: 'movie', count: 3, at: ago(1),
      covers: ['images/covers/drive-2011.jpg', 'images/covers/drive-2011.jpg', 'images/covers/drive-2011.jpg'], title_ids: ['a', 'b', 'c'] }],
    shelves: { [vadim.id]: { want: [{ id: 'a', title: 'Альфа', category: 'movie', year: 2020, cover: null, common: false },
      { id: 'b', title: 'Бета', category: 'movie', year: 2021, cover: null, common: false }, { id: 'c', title: 'Гамма', category: 'movie', year: 2022, cover: null, common: false }] } }
  });
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  await page.getByRole('button', { name: 'Обложка 2 из 3' }).click();
  await expect(page.getByRole('dialog', { name: 'Бета' })).toBeVisible();
  await page.goBack();
  // The strip of covers sits over the bottom of the line, so tap its text.
  await page.getByRole('button', { name: /^Вадим · добавлено 3 тайтла/ }).click({ position: { x: 120, y: 20 } });
  const list = page.getByRole('dialog', { name: 'Вадим · добавлено 3 тайтла' });
  await expect(list.getByRole('button', { name: /^«/ })).toHaveText([/Альфа/, /Бета/, /Гамма/]);
  await list.getByRole('button', { name: /^«Гамма»/ }).click();
  await expect(page.getByRole('dialog', { name: 'Гамма' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Гамма' })).toBeHidden();
  await list.getByRole('button', { name: 'Вся полка «Хочет»' }).click();
  await expect(list).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Вадим', exact: true }).getByRole('button', { name: 'Хочет', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('a long additions line scrolls sideways and lists every title', async ({ page }, info) => {
  const ids = Array.from({ length: 10 }, (_, i) => `t${i}`);
  await installStub(page, {
    signedIn: true, hasProfile: true, friends: [vadim],
    feed: [{ ...base, actor_id: vadim.id, actor_name: 'Вадим', kind: 'added', title_id: 't0', title: 'T0', category: 'movie', count: 10, at: ago(1),
      covers: ids.map(() => 'images/covers/drive-2011.jpg'), title_ids: ids }],
    shelves: { [vadim.id]: { want: ids.map((id, i) => ({ id, title: `Фильм ${i + 1}`, category: 'movie', year: 2000 + i, cover: null, common: false })) } }
  });
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  if (info.project.name === 'phone') {
    const last = page.getByRole('button', { name: 'Обложка 10 из 10' });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await last.click();
    await expect(page.getByRole('dialog', { name: 'Фильм 10' })).toBeVisible();
    await page.goBack();
  }
  await page.getByRole('button', { name: /^Вадим · добавлено 10 тайтлов/ }).first().click({ position: { x: 120, y: 20 } });
  const list = page.getByRole('dialog', { name: 'Вадим · добавлено 10 тайтлов' });
  await expect(list.getByRole('button', { name: /^«/ })).toHaveCount(10);
});

test('an empty feed says what will appear there', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true });
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  await expect(page.getByText('Здесь будет лента друзей', { exact: false })).toBeVisible();
});
