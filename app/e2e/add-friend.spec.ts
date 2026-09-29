import { test, expect, type Page } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';

const rpcCalls = (page: Page) => page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: unknown }[] }).__rpcCalls);
const nav = (page: Page) => page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true });
const katya = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Катя', nickname: 'katya' };

test('search by nickname: «Добавить» turns into «Заявка отправлена»', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, people: [katya, { id: 'x', name: 'Вадим', nickname: 'vadim' }] });
  await page.goto('./');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Добавить друга' });
  await expect(sheet.getByText('ledoksi.github.io', { exact: false }).or(sheet.getByText('#f/g7k2q4m9x1', { exact: false }))).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Ник' }).fill('kat');
  await expect(sheet.getByRole('list', { name: 'Найдено' }).getByRole('listitem')).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Добавить: Катя' }).click();
  await expect(sheet.getByRole('status')).toHaveText('Заявка отправлена');
  expect(await rpcCalls(page)).toContainEqual({ name: 'send_friend_request', args: { p_user: katya.id } });
  expect(await rpcCalls(page)).toContainEqual({ name: 'search_users', args: { p_prefix: 'kat' } });
});

test('a friend request waits above the feed and accepting adds the friend', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, friendRequests: [{ id: 3, user_id: katya.id, name: 'Катя', nickname: 'katya' }] });
  await page.goto('./');
  await expect(nav(page).getByRole('button', { name: /Друзья/ })).toContainText('1');
  await nav(page).getByRole('button', { name: /Друзья/ }).click();
  const requests = page.getByRole('region', { name: 'Заявки' });
  await expect(requests).toContainText('Катя хочет дружить');
  await requests.getByRole('button', { name: 'Принять: Катя' }).click();
  await expect(page.getByRole('region', { name: 'Заявки' })).toHaveCount(0);
  expect(await rpcCalls(page)).toContainEqual({ name: 'respond_friend_request', args: { p_id: 3, p_accept: true } });
  expect((await rpcCalls(page)).filter((c) => c.name === 'my_friends').length).toBeGreaterThan(1);
});

test('opening a friend link uses it after sign-in, says so and cleans the address', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, inviteOutcome: { status: 'requested', from_name: 'Георгий' } });
  await page.goto('./#f/ABC123xyz0');
  await expect(page.getByRole('status').filter({ hasText: 'Георгий зовёт в друзья' })).toBeVisible();
  expect(await rpcCalls(page)).toContainEqual({ name: 'complete_signup', args: { invite_token: 'abc123xyz0' } });
  expect(new URL(page.url()).hash).toBe('');
  // Used once: a reload does not send it again.
  await page.reload();
  await expect(page.locator('article').or(page.getByText('Здесь пока пусто'))).not.toHaveCount(0);
  expect(await rpcCalls(page)).not.toContainEqual({ name: 'complete_signup', args: { invite_token: 'abc123xyz0' } });
});

test('an expired link on a new account explains why it cannot get in', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: false, inviteOutcome: { status: 'expired' } });
  await page.goto('./#f/abc123xyz0');
  await expect(page.getByText('Ссылка-приглашение устарела', { exact: false })).toBeVisible();
});
