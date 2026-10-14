import { test } from '@playwright/test';
import { installStub } from './fixtures/supabaseStub';
test('fonts', async ({ page }) => {
  const reqs: string[] = [];
  page.on('response', (r) => { if (/woff|ttf|otf/.test(r.url())) reqs.push(r.status() + ' ' + r.url().split('/').pop()); });
  await installStub(page, { signedIn: true, hasProfile: true, friendRequests: [{ id: 7, user_id: '00000000-0000-4000-8000-0000000000e4', name: 'Катя', nickname: 'katya' }] });
  await page.goto('./');
  await page.getByRole('navigation', { name: 'Разделы' }).filter({ visible: true }).getByRole('button', { name: 'Друзья' }).click();
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.fonts.ready);
  const r = await page.evaluate(() => {
    const out: string[] = [];
    document.fonts.forEach((f) => { if (f.status === 'loaded') out.push(`${f.family} ${f.weight} ${f.style} ${f.unicodeRange.slice(0, 20)}`); });
    const c = document.createElement('canvas').getContext('2d')!;
    const w = (font: string) => { c.font = font; return c.measureText('5 тайтлов, вместе с: Даша хочет дружить').width.toFixed(2); };
    const el = [...document.querySelectorAll('b')].find((e) => e.textContent === 'Катя')?.parentElement as HTMLElement | undefined;
    const rg = document.createRange(); if (el) rg.selectNodeContents(el);
    return { req: el ? `box ${el.getBoundingClientRect().width} text ${rg.getBoundingClientRect().width} h ${el.offsetHeight} ${getComputedStyle(el).font}` : 'none', dpr: devicePixelRatio, ua: navigator.userAgent, loaded: out.length, onest400: w('400 13px Onest'), onest500: w('500 13px Onest'), sys: w('400 13px system-ui'), body: getComputedStyle(document.body).fontFamily };
  });
  console.log(JSON.stringify({ reqs, ...r }, null, 1));
});
