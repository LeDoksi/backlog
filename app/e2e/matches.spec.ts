import { test, expect, type Page } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';
import { catalogRows } from './fixtures/catalog';

const rpcCalls = (page: Page) => page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: { p_keys?: string[] } }[] }).__rpcCalls);
const nav = (page: Page) => page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true });
const vadim = { id: '00000000-0000-4000-8000-0000000000e2', name: 'Вадим', nickname: 'vadim', since: '2026-08-14T10:00:00Z' };
const lesha = { id: '00000000-0000-4000-8000-0000000000e3', name: 'Лёша', nickname: 'lesha', since: '2026-08-14T10:00:00Z' };
const rows = catalogRows(6);
const first = rows[0] as { id: string; title: string; category: string };
const key = `slug:${first.id}`;
const match = { friend_id: vadim.id, friend_name: 'Вадим', title_key: key, title: 'Бэтмен', category: 'movie', cover: null, my_status: 'queue', friend_status: 'queue' };

test('a card shows a friend who has the title; the panel lists them and opens their page', async ({ page }) => {
  await installStub(page, {
    signedIn: true, hasProfile: true, titles: rows, friends: [vadim, lesha],
    friendsOn: [
      { title_key: key, friend_id: vadim.id, friend_name: 'Вадим', status: 'done' },
      { title_key: key, friend_id: lesha.id, friend_name: 'Лёша', status: 'in_progress' }
    ]
  });
  await page.goto('./');
  const verb = first.category === 'game' ? 'играет' : 'смотрит';
  // The one on the card is the friend who is watching it now.
  const card = page.getByRole('button', { name: new RegExp(`^${first.title} — .* — Лёша ${verb}$`) });
  await expect(card).toBeVisible();
  const asked = (await rpcCalls(page)).filter((c) => c.name === 'friends_on_titles');
  expect(asked).toHaveLength(1);
  expect(asked[0]?.args.p_keys).toHaveLength(rows.length);

  await card.click();
  const sheet = page.getByRole('dialog', { name: first.title });
  const section = sheet.getByRole('region', { name: 'У друзей' });
  await expect(section.getByRole('button')).toHaveText([`ЛЛёша · ${verb}`, 'ВВадим · завершено']);
  await section.getByRole('button', { name: /Вадим/ }).click();
  const friend = page.getByRole('dialog', { name: 'Вадим' });
  await expect(friend.getByRole('button', { name: 'Завершено' })).toHaveAttribute('aria-pressed', 'true');
  // Back steps from the friend's page to the title, not past it.
  await page.goBack();
  await expect(friend).toHaveCount(0);
  await expect(sheet).toBeVisible();
});

test('Friends lists matches; a match opens the friend on the wanted shelf', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, friends: [vadim], matches: [match] });
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  const matches = page.getByRole('region', { name: 'Совпадения' });
  await matches.getByRole('button', { name: 'Совпадение: Ты и Вадим оба хотите «Бэтмен»' }).click();
  await expect(page.getByRole('dialog', { name: 'Вадим' }).getByRole('button', { name: 'Хочет' })).toHaveAttribute('aria-pressed', 'true');
});

test('wide desktop: a friends column beside the board, «Все» goes to Friends', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the column is for wide screens');
  const feedRow = { actor_id: vadim.id, actor_name: 'Вадим', kind: 'completed', title_id: 'x', workspace_id: 'w', title: 'Драйв', category: 'movie', cover: null, count: 1, covers: null, at: new Date().toISOString(), on_shared_board: false };
  await installStub(page, { signedIn: true, hasProfile: true, titles: rows, friends: [vadim], matches: [match], feed: [feedRow] });
  await page.goto('./');
  const column = page.getByRole('complementary', { name: 'У друзей' });
  await expect(column.getByRole('button', { name: /^Совпадение: / })).toBeVisible();
  await expect(column.getByRole('button', { name: /Вадим · завершено «Драйв»/ })).toBeVisible();
  // Looking at the column is not a visit to Friends: the badge stays.
  expect((await rpcCalls(page)).map((c) => c.name)).not.toContain('mark_feed_seen');
  await column.getByRole('button', { name: 'Все' }).click();
  await expect(page.getByRole('heading', { name: 'Друзья', level: 1 })).toBeVisible();
});

test('no friends, no column', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'the column is for wide screens');
  await installStub(page, { signedIn: true, hasProfile: true, titles: rows });
  await page.goto('./');
  await expect(page.getByRole('button', { name: new RegExp(`^${first.title}`) })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'У друзей' })).toHaveCount(0);
});
