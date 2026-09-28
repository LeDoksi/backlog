import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';
import { catalogRows, catalogTitles } from './fixtures/catalog';

test('long press offers statuses and does not open the panel', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch only');
  await installStub(page, { signedIn: true, hasProfile: true, drafts: catalogRows() });
  await page.goto('./');
  const plain = catalogTitles.find((t) => !t.parts && t.status === 'queue')!;
  const card = page.locator(`article[data-id="${plain.id}"]`);
  await card.scrollIntoViewIfNeeded();
  const hit = card.locator(':scope > button').first();
  const box = (await hit.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await hit.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: box.x + 20, clientY: box.y + 20, button: 0 });
  await page.waitForTimeout(650);
  await hit.dispatchEvent('pointerup', { pointerType: 'touch' });
  await hit.dispatchEvent('click');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await card.getByRole('button', { name: 'Завершено' }).click();
  await expect(card).toContainText('Завершено');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a plain tap opens the panel', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, drafts: catalogRows() });
  await page.goto('./');
  await page.locator('article > button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('the ⋯ button opens the same menu from the keyboard', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, drafts: catalogRows() });
  await page.goto('./');
  const plain = catalogTitles.find((t) => !t.parts && t.status === 'queue')!;
  const card = page.locator(`article[data-id="${plain.id}"]`);
  await card.getByRole('button', { name: `Быстрые действия: ${plain.title}` }).focus();
  await page.keyboard.press('Enter');
  await expect(card.getByRole('button', { name: 'В процессе' }).or(card.getByRole('button', { name: 'Смотрю' }))).toBeVisible();
});
