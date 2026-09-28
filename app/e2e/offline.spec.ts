import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';
import { catalogRows, catalogTitles } from './fixtures/catalog';

test('an edit made offline shows at once and goes out when the network is back', async ({ page, context }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: catalogRows(12) });
  await page.goto('./');
  const plain = catalogTitles.slice(0, 12).find((t) => !t.parts && t.status === 'queue')!;
  const card = page.locator(`article[data-id="${plain.id}"]`);
  await expect(card).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText('Нет сети, правки сохранятся')).toBeVisible();
  await card.locator(':scope > button').first().click();
  await page.getByRole('dialog').getByRole('radio', { name: 'Завершено' }).click();
  await page.keyboard.press('Escape');
  await expect(card).toContainText('Завершено');
  await expect(page.getByText('Нет сети, правки сохранятся · 1')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole('status').filter({ hasText: /сети|Не сохранено/ })).toHaveCount(0);
  const writes = await page.evaluate(() => (window as unknown as { __writes?: { op: string; table: string; id?: string; row?: { status?: string } }[] }).__writes ?? []);
  expect(writes.some((w) => w.op === 'update' && w.table === 'titles' && w.id === plain.id && w.row?.status === 'done')).toBe(true);
});
