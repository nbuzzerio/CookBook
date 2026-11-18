import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { launchBrowser, localURL } from '../scripts/browser-local.mjs';
import { readLibrary } from '../scripts/browser-storage.mjs';

const base = localURL(443);
const { origin } = new URL(base);
const [commit] = process.argv.slice(2);
const browser = await launchBrowser();
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => {
    if (new URL(r.url()).origin !== origin || r.url().includes('/exchange')) errors.push(r.url());
  });
  await page.goto(origin + '/apps/workout/');
  await page.evaluate(async () => {
    localStorage.setItem('workout-test', 'keep');
    await caches.open('calendar-test');
  });
  await context.addCookies([{ name: 'fixture', value: 'household', domain: '127.0.0.1',
    path: '/api/v1/', secure: true, httpOnly: true, sameSite: 'Strict' }]);
  await page.goto(base.slice(0, -1));
  assert.equal(page.url(), base);
  await expect(page.locator('.recipe-card')).toHaveCount(3);
  const covers = await page.locator('.recipe-card img').evaluateAll(async images => {
    await Promise.all(images.map(img => img.decode()));
    return images.map(img => img.src);
  });
  assert.deepEqual(covers.sort(), ['meatloaf', 'sausage', 'ziti'].map(id => base + 'assets/images/' + id + '.jpg'));
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  const marker = await page.evaluate(async () => (await fetch('./release.json')).json());
  assert.equal(marker.commit, commit);
  const cached = await page.evaluate(async base => {
    const sw = navigator.serviceWorker;
    if ((await sw.getRegistration()).scope !== base || sw.controller.scriptURL !== base + 'sw.js')
      throw Error('Incorrect Countertop worker or scope');
    for (const scope of ['/', '/apps/workout/', '/apps/calendar/', '/api/v1/']) {
      if (await sw.getRegistration(scope)) throw Error('Worker controls ' + scope);
      let denied = false;
      try { await sw.register(base + 'sw.js', { scope }); }
      catch (e) { denied = e.name === 'SecurityError'; }
      if (!denied) throw Error('Browser accepted worker with scope ' + scope);
    }
    const names = await caches.keys();
    if (!names.includes('calendar-test') || localStorage.getItem('workout-test') !== 'keep') throw Error('Sibling storage changed');
    const owned = names.filter(n => n.startsWith('countertop-static-'));
    if (owned.length !== 1) throw Error('Expected one Countertop cache');
    return (await (await caches.open(owned[0])).keys()).map(r => r.url).sort();
  }, base);
  assert.deepEqual(cached, Object.keys(marker.files).filter(n => n !== 'sw.js').map(n => base + n).sort());

  const device = (await readLibrary(page)).device;
  assert.match(device, /^[0-9a-f-]{36}$/);
  await page.goto(base + '#/settings/sync');
  const logout = page.waitForResponse(r => r.url() === origin + '/api/v1/auth/logout');
  await page.getByRole('button', { name: 'Sign out' }).click();
  assert.equal((await logout).status(), 204, 'same-origin session, Origin and CSRF token');
  await page.goto(base + '#/recipe/spinach-mushroom-baked-ziti/overview');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.recipe-heading')).toContainText('Baked Ziti');
  assert.equal((await readLibrary(page)).device, device);
  assert.equal(await page.evaluate(() => fetch('/api/v1/auth/session').then(() => 'served', () => 'offline')), 'offline');
  assert.deepEqual(errors, []);
  console.log('PASS packaged HTTPS release, hash navigation, sample covers, IndexedDB, cookie/CSRF, worker isolation and offline reopening');
} finally {
  await browser.close();
}
