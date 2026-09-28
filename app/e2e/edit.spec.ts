import { test, expect } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';
import { catalogRows, catalogTitles } from './fixtures/catalog';

test('editing the name shows on the card', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: catalogRows() });
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
  await installStub(page, { signedIn: true, hasProfile: true, titles: catalogRows() });
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
  await installStub(page, { signedIn: true, hasProfile: true, titles: catalogRows() });
  await page.goto('./');
  const t = catalogTitles.find((x) => x.parts)!;
  await page.locator(`article[data-id="${t.id}"] > button`).first().click();
  await page.getByRole('button', { name: 'Редактировать' }).click();
  const form = page.getByRole('dialog', { name: 'Редактирование' });
  await expect(form.getByText('Сезоны и части')).toBeVisible();
  await form.getByRole('radio', { name: 'Кино' }).click();
  await expect(form.getByText('Сезоны и части')).toBeHidden();
});

test('removing a watched season keeps the other ticks on their seasons', async ({ page }) => {
  const t = catalogTitles.find((x) => x.parts && x.parts.length >= 2 && x.parts[0]!.released !== false && x.parts[1]!.released !== false)!;
  // Season 2 watched, season 1 not.
  await installStub(page, { signedIn: true, hasProfile: true, titles: catalogRows(), parts: [{ id: t.id, indices: [1] }] });
  await page.goto('./');
  await page.locator(`article[data-id="${t.id}"] > button`).first().click();
  const sheet = page.getByRole('dialog', { name: t.title });
  await expect(sheet.getByRole('checkbox', { name: new RegExp(t.parts![1]!.name) })).toBeChecked();
  await sheet.getByRole('button', { name: 'Редактировать' }).click();
  const form = page.getByRole('dialog', { name: 'Редактирование' });
  await form.getByRole('button', { name: 'Удалить часть 1' }).click();
  await form.getByRole('button', { name: 'Сохранить' }).click();
  await expect(form).toBeHidden();
  // Former season 2 is now first and still ticked.
  const boxes = sheet.getByRole('checkbox');
  await expect(boxes.first()).toHaveAccessibleName(new RegExp(t.parts![1]!.name));
  await expect(boxes.first()).toBeChecked();
});
