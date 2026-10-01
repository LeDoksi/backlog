import { test, expect, type Page } from '@playwright/test';
import { installStub, PERSONAL, SHARED } from './fixtures/supabaseStub';
import { catalogRows } from './fixtures/catalog';

const rpcCalls = (page: Page) => page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: unknown }[] }).__rpcCalls);
const nav = (page: Page) => page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true });
const vadim = { id: '00000000-0000-4000-8000-0000000000e2', name: 'Вадим', nickname: 'vadim', since: '2026-08-14T10:00:00Z' };
const dasha = { id: '00000000-0000-4000-8000-0000000000d1', name: 'Даша', nickname: 'dasha' };
const arrival = { id: 'arrival-2016', title: 'Прибытие', category: 'movie', year: 2016, cover: 'images/covers/drive-2011.jpg', common: false };
const feedLine = { actor_id: vadim.id, actor_name: 'Вадим', kind: 'completed', title_id: arrival.id, workspace_id: 'w', title: arrival.title, category: 'movie', cover: null, count: 1, covers: null, at: new Date().toISOString(), on_shared_board: false };

async function openArrival(page: Page) {
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  await page.getByRole('button', { name: /^Вадим · завершено/ }).click();
  await page.getByRole('dialog', { name: 'Вадим' }).getByRole('button', { name: 'Прибытие' }).click();
  return page.getByRole('dialog', { name: 'Прибытие' });
}

test('with a shared board it asks where: «Моё» or «Общее»; a second copy says it is already there', async ({ page }) => {
  await installStub(page, {
    signedIn: true, hasProfile: true, friends: [vadim], feed: [feedLine], titles: catalogRows(2), sharedTitles: catalogRows(2, 2), sharedWith: [dasha],
    shelves: { [vadim.id]: { done: [arrival] } }
  });
  const card = await openArrival(page);
  await expect(card.getByText('Добавить к себе')).toBeVisible();
  await card.getByRole('button', { name: 'В Общее' }).click();
  await expect(card.getByRole('status')).toHaveText('Добавлено в «Общее»');
  await card.getByRole('button', { name: 'В Общее' }).click();
  await expect(card.getByRole('status')).toHaveText('Уже есть в «Общее»');
  await card.getByRole('button', { name: 'В Моё' }).click();
  await expect(card.getByRole('status')).toHaveText('Добавлено в «Моё»');
  const calls = await rpcCalls(page);
  expect(calls).toContainEqual({ name: 'copy_from_friend', args: { p_owner: vadim.id, p_title_id: arrival.id, p_to: SHARED } });
  expect(calls).toContainEqual({ name: 'copy_from_friend', args: { p_owner: vadim.id, p_title_id: arrival.id, p_to: PERSONAL } });
});

test('without a shared board one button adds it to «Моё»', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, friends: [vadim], feed: [feedLine], titles: catalogRows(2), shelves: { [vadim.id]: { done: [arrival] } } });
  const card = await openArrival(page);
  await expect(card.getByRole('button', { name: 'В Общее' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Добавить к себе' }).click();
  await expect(card.getByRole('status')).toHaveText('Добавлено в «Моё»');
  expect(await rpcCalls(page)).toContainEqual({ name: 'copy_from_friend', args: { p_owner: vadim.id, p_title_id: arrival.id, p_to: PERSONAL } });
});
