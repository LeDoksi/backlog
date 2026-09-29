import { test, expect, type Page } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';

const rpcCalls = (page: Page) => page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: unknown }[] }).__rpcCalls);
const nav = (page: Page) => page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true });
const vadim = { id: '00000000-0000-4000-8000-0000000000e2', name: 'Вадим', nickname: 'vadim', since: '2026-08-14T10:00:00Z' };
const item = (id: string, title: string, common = false) => ({ id, title, category: 'movie', year: 2020, cover: 'images/covers/drive-2011.jpg', common });

test('a feed line opens the friend on the right tab with the taste match; removing asks first', async ({ page }) => {
  await installStub(page, {
    signedIn: true, hasProfile: true, friends: [vadim],
    feed: [{ actor_id: vadim.id, actor_name: 'Вадим', kind: 'parts', title_id: 'x', workspace_id: 'w', title: 'Тед Лассо', category: 'series', cover: null, count: 2, covers: null, at: new Date().toISOString(), on_shared_board: false }],
    shelves: { [vadim.id]: { watching: [item('ted', 'Тед Лассо', true)], done: [item('drive', 'Драйв', true), item('alien', 'Чужой')] } },
    taste: { [vadim.id]: { status: 'ok', percent: 72, common: 14, both_want: 5, genres: ['фэнтези', 'драма'] } }
  });
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  await page.getByRole('button', { name: /Вадим · 2 сезона «Тед Лассо»/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Вадим' });
  await expect(sheet.getByText('@vadim, в друзьях с 14 августа')).toBeVisible();
  await expect(sheet.getByRole('region', { name: 'Совпадение вкусов' })).toContainText('72%');
  await expect(sheet.getByRole('region', { name: 'Совпадение вкусов' })).toContainText('14 общих тайтлов');
  await expect(sheet.getByRole('button', { name: 'Смотрит' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.getByRole('list', { name: 'Смотрит' }).getByRole('listitem')).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Завершено' }).click();
  const done = sheet.getByRole('list', { name: 'Завершено' });
  await expect(done.getByRole('listitem')).toHaveCount(2);
  await expect(done.getByText('общее')).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Ещё' }).click();
  await sheet.getByRole('button', { name: 'Удалить из друзей' }).click();
  await page.getByRole('dialog', { name: 'Удалить Вадим из друзей?' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(page.getByRole('dialog', { name: 'Вадим' })).toHaveCount(0);
  expect(await rpcCalls(page)).toContainEqual({ name: 'remove_friend', args: { p_user: vadim.id } });
});

test('too little to compare says so; a switched-off match hides the card', async ({ page }) => {
  const lesha = { ...vadim, id: '00000000-0000-4000-8000-0000000000e3', name: 'Лёша', nickname: 'lesha' };
  await installStub(page, {
    signedIn: true, hasProfile: true, friends: [vadim, lesha], taste: { [lesha.id]: { status: 'disabled' } },
    feed: [vadim, lesha].map((f) => ({ actor_id: f.id, actor_name: f.name, kind: 'completed', title_id: 'x', workspace_id: 'w', title: 'X', category: 'movie', cover: null, count: 1, covers: null, at: new Date().toISOString(), on_shared_board: false }))
  });
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  await page.getByRole('button', { name: /^Вадим · завершено/ }).click();
  await expect(page.getByRole('dialog', { name: 'Вадим' }).getByText('Пока мало данных для сравнения')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /^Лёша · завершено/ }).click();
  await expect(page.getByRole('dialog', { name: 'Лёша' }).getByText('Здесь пусто', { exact: false })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Лёша' }).getByRole('region', { name: 'Совпадение вкусов' })).toHaveCount(0);
});
