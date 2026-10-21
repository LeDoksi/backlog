import { test, expect, type Page } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';
import { catalogRows } from './fixtures/catalog';

// «Другое» (BL-119): off by default, switched on in the profile; hand-made
// lines with the board's own categories as filters, outside «Всё».
const rows = catalogRows();
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Категории' });
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true }).getByRole('button', { name });
const rpcCalls = (page: Page) => page.evaluate(() => (window as unknown as { __rpcCalls: { name: string; args: Record<string, unknown> }[] }).__rpcCalls);

async function addLine(page: Page, title: string, category: string, extra: { description?: string; link?: string; done?: boolean } = {}) {
  await page.getByRole('button', { name: 'Добавить тайтл' }).filter({ visible: true }).click();
  const form = page.getByRole('dialog', { name: 'Новая запись' });
  await form.getByLabel('Название').fill(title);
  await form.getByLabel('Категория').fill(category);
  if (extra.done) await form.getByRole('radio', { name: 'Готово' }).click();
  if (extra.description) await form.getByLabel('Описание').fill(extra.description);
  if (extra.link) await form.getByLabel('Ссылка 1').fill(extra.link);
  await form.getByRole('button', { name: 'Сохранить' }).click();
  await expect(form).toHaveCount(0);
}

test('off by default: no tab and no requests', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: rows });
  await page.goto('./');
  await expect(page.locator('article').first()).toBeVisible();
  await expect(tabs(page).getByRole('button', { name: /^Другое/ })).toHaveCount(0);
  expect((await rpcCalls(page)).map((c) => c.name)).not.toContain('other_items');
});

test('switched on in the profile: add books and restaurants, filter, edit, delete with undo', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, titles: rows });
  await page.goto('./');
  await nav(page, 'Профиль').click();
  const toggle = page.getByRole('switch', { name: 'Вкладка «Другое»' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  expect(await rpcCalls(page)).toContainEqual({ name: 'set_show_other', args: { p_on: true } });

  await nav(page, 'Бэклог').click();
  const allCount = await tabs(page).getByRole('button', { name: /^Всё/ }).textContent();
  await tabs(page).getByRole('button', { name: /^Другое/ }).click();
  await expect(page.getByText('Сюда можно записать то, чего нет в поиске')).toBeVisible();

  // «+» here opens the form, not search.
  await addLine(page, 'Дюна', 'Книги', { description: 'Фрэнк Херберт', link: 'livelib.ru/book/1' });
  await addLine(page, 'Пушкин', 'Рестораны', { done: true });
  await addLine(page, 'Сапиенс', 'книги');
  const list = page.getByRole('list', { name: 'Записи' });
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await expect(tabs(page).getByRole('button', { name: /^Другое/ })).toContainText('3');
  await expect(tabs(page).getByRole('button', { name: /^Всё/ })).toHaveText(allCount!);

  // Two categories: filters appear; «книги» joined «Книги».
  const filters = page.getByRole('group', { name: 'Фильтры «Другого»' });
  await expect(filters.getByRole('button', { name: /^Книги/ })).toContainText('2');
  await filters.getByRole('button', { name: /^Рестораны/ }).click();
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await filters.getByRole('button', { name: /^Рестораны/ }).click();
  await filters.getByRole('button', { name: /^Хочу/ }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await filters.getByRole('button', { name: /^Хочу/ }).click();

  // The line: link by domain, status, rating, edit.
  await list.getByRole('button', { name: /Дюна/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Дюна' });
  await expect(sheet.getByRole('link', { name: 'livelib.ru' })).toHaveAttribute('href', 'https://livelib.ru/book/1');
  await sheet.getByRole('radio', { name: 'Готово' }).click();
  await sheet.getByRole('radio', { name: '9' }).click();
  await expect(sheet.getByRole('radio', { name: '9' })).toHaveAttribute('aria-checked', 'true');
  await sheet.getByRole('button', { name: 'Изменить' }).click();
  const form = page.getByRole('dialog', { name: 'Изменить запись' });
  await form.getByLabel('Название').fill('Дюна. Мессия');
  await form.getByRole('button', { name: 'Сохранить' }).click();
  await expect(list.getByRole('button', { name: /Дюна\. Мессия/ })).toContainText('оценка 9');

  // Delete, then «Отменить».
  await list.getByRole('button', { name: /Дюна\. Мессия/ }).click();
  await page.getByRole('dialog', { name: 'Дюна. Мессия' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await page.getByRole('button', { name: 'Отменить' }).click();
  await expect(list.getByRole('listitem')).toHaveCount(3);

  // After a reload the setting and the lines are still there.
  await page.reload();
  await expect(tabs(page).getByRole('button', { name: /^Другое/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('list', { name: 'Записи' }).getByRole('listitem')).toHaveCount(3);
});

test('an empty title is refused under the field', async ({ page }) => {
  await installStub(page, { signedIn: true, hasProfile: true, showOther: true });
  await page.goto('./');
  await tabs(page).getByRole('button', { name: /^Другое/ }).click();
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  const form = page.getByRole('dialog', { name: 'Новая запись' });
  await form.getByLabel('Ссылка 1').fill('javascript:alert(1)');
  await form.getByRole('button', { name: 'Сохранить' }).click();
  await expect(form.getByText('Напиши название')).toBeVisible();
  await expect(form.getByText('Выбери или напиши категорию')).toBeVisible();
  await expect(form.getByText('Ссылка должна выглядеть как https://сайт.ru/…')).toBeVisible();
  expect((await rpcCalls(page)).map((c) => c.name)).not.toContain('save_other_item');
});

test('on a shared board someone else\'s line: status yes, text no', async ({ page }) => {
  await installStub(page, {
    signedIn: true, hasProfile: true, showOther: true, titles: rows, sharedTitles: [],
    sharedWith: [{ id: '00000000-0000-4000-8000-0000000000d1', name: 'Даша', nickname: 'dasha' }],
    otherItems: { shared: [{ id: '00000000-0000-4000-8000-00000000aa01', title: 'Гамлет', category: 'Театр', created_at: '2026-10-20T10:00:00Z', mine: false }] }
  });
  await page.goto('./');
  await page.getByRole('group', { name: 'Доска' }).getByRole('button', { name: /Общее/ }).click();
  await tabs(page).getByRole('button', { name: /^Другое/ }).click();
  await page.getByRole('button', { name: /Гамлет/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Гамлет' });
  await expect(sheet.getByText('Текст меняет тот, кто добавил запись')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Изменить' })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Удалить' })).toHaveCount(0);
  await sheet.getByRole('radio', { name: 'Готово' }).click();
  await expect(sheet.getByRole('radio', { name: 'Готово' })).toHaveAttribute('aria-checked', 'true');
});

const KB = 300, PAN = 150;
// iOS keeps the window full height under the keyboard and pans the page; a
// stand-in visualViewport plays that: the form must sit in what is visible.
test('with the phone keyboard up the form stays in view: name on top, buttons above the keys', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone');
  await page.addInitScript(([kb, pan]) => {
    const t = new EventTarget() as EventTarget & { height: number; offsetTop: number; width: number };
    Object.assign(t, { height: window.innerHeight, offsetTop: 0, width: window.innerWidth });
    Object.defineProperty(window, 'visualViewport', { value: t });
    (window as unknown as { __kb(on: boolean): void }).__kb = (on) => {
      t.height = on ? window.innerHeight - kb! - pan! : window.innerHeight; t.offsetTop = on ? pan! : 0;
      t.dispatchEvent(new Event('resize'));
    };
  }, [KB, PAN]);
  await installStub(page, { signedIn: true, hasProfile: true, showOther: true });
  await page.goto('./');
  await page.getByRole('navigation', { name: 'Категории' }).getByRole('button', { name: /^Другое/ }).click();
  await page.getByRole('button', { name: 'Добавить запись' }).click();
  await page.evaluate(() => (window as unknown as { __kb(on: boolean): void }).__kb(true));
  const form = page.getByRole('dialog', { name: 'Новая запись' });
  await page.waitForTimeout(500);
  const bottom = page.viewportSize()!.height - KB;
  const title = (await form.getByLabel('Название').boundingBox())!;
  const save = (await form.getByRole('button', { name: 'Сохранить' }).boundingBox())!;
  expect(title.y).toBeGreaterThanOrEqual(PAN);
  expect(save.y + save.height).toBeLessThanOrEqual(bottom);
});
