import { test, expect, type Page } from '@playwright/test';
import { installStub, PERSONAL } from './fixtures/supabaseStub';
import { catalogRows } from './fixtures/catalog';

const rpcCalls = (page: Page) => page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: unknown }[] }).__rpcCalls);
const nav = (page: Page) => page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true });
const vadim = { id: '00000000-0000-4000-8000-0000000000e2', name: 'Вадим', nickname: 'vadim', since: '2026-08-14T10:00:00Z' };
const ozark = { id: 'ozark-2017', title: 'Озарк', category: 'series', year: 2017, cover: 'images/covers/drive-2011.jpg', common: false };
const feedLine = { actor_id: vadim.id, actor_name: 'Вадим', kind: 'completed', title_id: 'x', workspace_id: 'w', title: 'X', category: 'movie', cover: null, count: 1, covers: null, at: new Date().toISOString(), on_shared_board: false };

async function openFriend(page: Page) {
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  await page.getByRole('button', { name: 'Вадим', exact: true }).first().click();
  return page.getByRole('dialog', { name: 'Вадим' });
}

test('a title on a friend\'s shelf opens its card; adding goes through copy_from_friend; Back returns to the friend', async ({ page }) => {
  await installStub(page, {
    signedIn: true, hasProfile: true, friends: [vadim], feed: [feedLine], titles: catalogRows(2),
    shelves: { [vadim.id]: { done: [ozark] } },
    friendTitles: { [`${vadim.id}:${ozark.id}`]: { ...ozark, original_title: 'Ozark', genres: ['драма'], synopsis: 'Финансист отмывает деньги.', platforms: null,
      parts: [{ name: 'Сезон 1', year: 2017 }, { name: 'Сезон 2', year: 2018 }], checked: [0, 1], status: 'done', rating: 9, title_key: 'tmdb-tv:69740', mine_id: null } }
  });
  const friend = await openFriend(page);
  await friend.getByRole('button', { name: 'Озарк' }).click();
  const card = page.getByRole('dialog', { name: 'Озарк' });
  await expect(card.getByText('Вадим · завершено, 9/10')).toBeVisible();
  await expect(card.getByText('Финансист отмывает деньги.')).toBeVisible();
  await expect(card.getByRole('checkbox')).toHaveCount(2);
  await expect(card.getByRole('checkbox').first()).toBeDisabled();
  await card.getByRole('button', { name: 'Добавить к себе' }).click();
  await expect(card.getByRole('status')).toHaveText('Добавлено в «Моё»');
  expect(await rpcCalls(page)).toContainEqual({ name: 'copy_from_friend', args: { p_owner: vadim.id, p_title_id: ozark.id, p_to: PERSONAL } });
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Озарк' })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Вадим' })).toBeVisible();
});

test('a title gone from sight says so', async ({ page }) => {
  await installStub(page, {
    signedIn: true, hasProfile: true, friends: [vadim], feed: [feedLine], titles: catalogRows(2),
    shelves: { [vadim.id]: { done: [ozark] } }, friendTitles: { [`${vadim.id}:${ozark.id}`]: null }
  });
  const friend = await openFriend(page);
  await friend.getByRole('button', { name: 'Озарк' }).click();
  await expect(page.getByRole('dialog', { name: 'Тайтл недоступен' })).toBeVisible();
});
