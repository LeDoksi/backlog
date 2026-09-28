import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';
import { catalogRows } from './fixtures/catalog';

const mine = catalogRows(4);
const ours = catalogRows(6, 4);
const dasha = { id: '00000000-0000-4000-8000-0000000000d1', name: 'Даша', nickname: 'dasha' };
const allTab = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Категории' }).getByRole('button', { name: /^Всё/ });

test('with one board there is no switch', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: mine });
  await page.goto('./');
  await expect(page.locator('article')).toHaveCount(4);
  await expect(page.getByRole('group', { name: 'Доска' })).toHaveCount(0);
});

test('the switch changes the grid and the tab counts', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: mine, sharedTitles: ours, sharedWith: [dasha] });
  await page.goto('./');
  const sw = page.getByRole('group', { name: 'Доска' });
  await expect(sw.getByRole('button', { name: 'Моё' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('article')).toHaveCount(4);
  await expect(allTab(page)).toContainText('4');
  await sw.getByRole('button', { name: /Общее/ }).click();
  await expect(page.locator('article')).toHaveCount(6);
  await expect(allTab(page)).toContainText('6');
  await expect(page.locator(`article[data-id="${String(ours[0]!.id)}"]`)).toBeVisible();
  // The choice survives a reload.
  await page.reload();
  await expect(page.getByRole('group', { name: 'Доска' }).getByRole('button', { name: /Общее/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('article')).toHaveCount(6);
});

test('copying puts the title into the other board as «В бэклоге», and a second copy is refused', async ({ page }) => {
  const src = ours.find((r) => r.status === 'done' && !r.parts) ?? ours.find((r) => !r.parts)!;
  await installStub(page, { signedIn: true, hasProfile: true, titles: mine, sharedTitles: ours, sharedWith: [dasha] });
  await page.goto('./');
  const sw = page.getByRole('group', { name: 'Доска' });
  await sw.getByRole('button', { name: /Общее/ }).click();
  const card = page.locator(`article[data-id="${String(src.id)}"]`);
  await card.locator(':scope > button').first().click();
  const sheet = page.getByRole('dialog', { name: String(src.title) });
  await sheet.getByRole('button', { name: 'Копировать в «Моё»' }).click();
  await expect(sheet.getByRole('status')).toHaveText('Скопировано в «Моё»');
  await sheet.getByRole('button', { name: 'Копировать в «Моё»' }).click();
  await expect(sheet.getByRole('status')).toHaveText('Уже есть в «Моё»');
  await page.keyboard.press('Escape');
  await sw.getByRole('button', { name: 'Моё' }).click();
  await expect(page.locator('article')).toHaveCount(5);
  await expect(page.locator(`article[data-id="${String(src.id)}"]`)).toContainText('В бэклоге');
});
