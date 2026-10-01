import { test, expect, type Page } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true });
const vadim = { id: '00000000-0000-4000-8000-0000000000e2', name: 'Вадим', nickname: 'vadim', since: '2026-08-14T10:00:00Z' };
const lesha = { id: '00000000-0000-4000-8000-0000000000e3', name: 'Лёша', nickname: 'lesha', since: '2026-08-20T10:00:00Z' };
const match = { friend_id: vadim.id, friend_name: 'Вадим', title_key: 'slug:batman', title: 'Бэтмен', category: 'movie', cover: null, my_status: 'queue', friend_status: 'queue' };
const line = { actor_id: lesha.id, actor_name: 'Лёша', kind: 'completed', title_id: 'x', workspace_id: 'w', title: 'Драйв', category: 'movie', cover: null, count: 1, covers: null, at: new Date().toISOString(), on_shared_board: false };
const setup = (page: Page) => installStub(page, {
  signedIn: true, hasProfile: true, friends: [vadim, lesha], matches: [match], feed: [line],
  friendRequests: [{ id: 7, user_id: '00000000-0000-4000-8000-0000000000e4', name: 'Катя', nickname: 'katya' }],
  taste: { [vadim.id]: { status: 'ok', percent: 72, common: 14, both_want: 5, genres: [] }, [lesha.id]: { status: 'not_enough' } }
});

test('phone: tabs for feed, matches and friends with counts; friends show taste match', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'tabs are the phone layout');
  await setup(page);
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  const tabs = page.getByRole('radiogroup', { name: 'Раздел' });
  await expect(tabs.getByRole('radio')).toHaveText(['Лента', 'Совпадения 1', 'Друзья 2']);
  await expect(page.getByRole('region', { name: 'Заявки' })).toContainText('Катя');
  await expect(page.getByRole('button', { name: /Лёша · завершено «Драйв»/ })).toBeVisible();
  await tabs.getByRole('radio', { name: 'Друзья 2' }).click();
  const list = page.getByRole('list', { name: 'Друзья' });
  await expect(list.getByRole('button', { name: 'Вадим, @vadim, совпадение вкусов 72%' })).toBeVisible();
  await expect(list.getByRole('button', { name: 'Лёша, @lesha' })).toBeVisible();
  await list.getByRole('button', { name: /^Вадим/ }).click();
  await expect(page.getByRole('dialog', { name: 'Вадим' })).toBeVisible();
});

test('desktop: the feed on the left; requests, friends and matches on the right', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'two columns are the desktop layout');
  await setup(page);
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  await expect(page.getByRole('radiogroup', { name: 'Раздел' })).toHaveCount(0);
  const feed = page.getByRole('region', { name: 'Лента' });
  await expect(feed.getByRole('button', { name: /Лёша · завершено «Драйв»/ })).toBeVisible();
  const aside = page.getByRole('complementary');
  await expect(aside.getByRole('region', { name: 'Заявки' })).toContainText('Катя');
  await expect(aside.getByRole('list', { name: 'Друзья' }).getByRole('listitem')).toHaveCount(2);
  await expect(aside.getByRole('button', { name: /совпадение вкусов 72%/ })).toBeVisible();
  await expect(aside.getByRole('list', { name: 'Совпадения' })).toContainText('Ты и Вадим оба хотите «Бэтмен»');
  await aside.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /Добавить/ })).toBeVisible();
});
