import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';
import { catalogRows, catalogTitles } from './fixtures/catalog';

test('editing the name shows on the card', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, drafts: catalogRows() });
  await page.goto('./');
  const t = catalogTitles.find((x) => !x.parts)!;
  const card = page.locator(`article[data-id="${t.id}"]`);
  await card.locator(':scope > button').first().click();
  await page.getByRole('button', { name: 'Редактировать' }).click();
  const form = page.getByRole('dialog', { name: 'Редактирование' });
  const name = form.getByRole('textbox', { name: 'Название', exact: true });
  await name.fill('Новое имя');
  await form.getByRole('button', { name: 'Сохранить' }).click();
  await expect(form).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(card).toContainText('Новое имя');
});

test('leaving with changes asks first, Back included', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, drafts: catalogRows() });
  await page.goto('./');
  await page.locator('article > button').first().click();
  await page.getByRole('button', { name: 'Редактировать' }).click();
  const form = page.getByRole('dialog', { name: 'Редактирование' });
  await form.getByRole('textbox', { name: 'Название', exact: true }).fill('Черновое');
  await page.goBack();
  await expect(page.getByText('Отменить изменения?')).toBeVisible();
  await page.getByRole('button', { name: 'Отмена', exact: true }).last().click();
  await expect(form).toBeVisible();
  await form.getByRole('button', { name: 'Закрыть без сохранения' }).click();
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(form).toBeHidden();
  // The title sheet underneath is still open: Back stepped out of the form only.
  await expect(page.getByRole('button', { name: 'Редактировать' })).toBeVisible();
});

test('switching to Кино hides the parts editor', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, drafts: catalogRows() });
  await page.goto('./');
  const t = catalogTitles.find((x) => x.parts)!;
  await page.locator(`article[data-id="${t.id}"] > button`).first().click();
  await page.getByRole('button', { name: 'Редактировать' }).click();
  const form = page.getByRole('dialog', { name: 'Редактирование' });
  await expect(form.getByText('Сезоны и части')).toBeVisible();
  await form.getByRole('radio', { name: 'Кино' }).click();
  await expect(form.getByText('Сезоны и части')).toBeHidden();
});
