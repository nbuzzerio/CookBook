import { readLibrary, setRestoreFixture } from './browser-storage.mjs';
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const base = process.env.COUNTERTOP_URL || 'http://127.0.0.1:5175/';
const recipes = await Promise.all(['mushroom-meatloaf-dinner', 'spinach-mushroom-baked-ziti'].map(async name => JSON.parse(await fs.readFile(`src/data/recipes/${name}.json`, 'utf8'))));
const [recipe, other] = recipes;
const timedStep = recipe.events.find(event => event.timerMinutes);
const prefix = 'countertop:v1:';
const note = 'Buy the certified GF oats.\nRemember <b>vegetarian</b> cheese.';
await fs.mkdir('.qa/full-backup', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'light', reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const snapshot = () => page.evaluate(prefix => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))), prefix);
  const read = async key => {
    if (['recipes','shopping-notes'].includes(key)) {
      const state = await readLibrary(page);
      return key === 'recipes' ? state.recipes : state.privateNotes;
    }
    return readLocal(key);
  };
  const readLocal = key => page.evaluate(({ prefix, key }) => JSON.parse(localStorage.getItem(prefix + key))?.value, { prefix, key });
  const upload = async (value, name = 'countertop-full-backup.json') => page.getByLabel('Restore full cookbook backup file').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
  const panel = page.getByRole('region', { name: 'Full cookbook backup', exact: true });
  const preview = page.getByRole('region', { name: 'Review full cookbook restore', exact: true });
  await page.route(base, route => route.fulfill({contentType:'text/html', body:'<title>Migration fixture</title>'}), {times:1});
  await page.goto(base);
  await page.evaluate(({ prefix, recipes, timedStep, note }) => {
    const save = (key, value) => localStorage.setItem(prefix + key, JSON.stringify({ version: 1, value }));
    const [recipe, other] = recipes;
    const startedAt = Date.now() - 60_000;
    save('recipes', recipes);
    save('favorites', [recipe.id]);
    save('theme', 'dark');
    save('shopping-plan', [{ recipeId: recipe.id, servings: 8 }, { recipeId: other.id, servings: 3 }]);
    save('servings', { [recipe.id]: 8, [other.id]: 3 });
    save('shopping-notes', { [recipe.id]: note });
    save(`ingredients:${recipe.id}`, [recipe.ingredients[0].id]);
    save(`session:${recipe.id}`, { status: 'running', accumulatedMs: 5000, startedAt, selectedId: timedStep.id, completedIds: [recipe.events[1].id], timers: { [timedStep.id]: { durationMs: 1_800_000, remainingMs: 1_800_000, startedAt, status: 'running' } } });
    save('dinner-timing', { serveAt: Math.ceil((Date.now() + 86_400_000) / 60_000) * 60_000 });
    localStorage.setItem('another-app:keep', 'untouched');
  }, { prefix, recipes, timedStep, note });
  await page.goto(`${base}#/settings`);
  await page.reload();
  await page.goto(`${base}#/shopping`);
  await page.locator('.shopping-item input').first().check();
  await page.getByRole('button', { name: 'Clear purchased', exact: true }).click();
  await page.locator('.shopping-item input').first().check();
  const groceryRows = await page.locator('.shopping-item').allTextContents();
  const shoppingChecklist = await read('shopping-checklist');
  assert.equal(shoppingChecklist.checked.length, 2);
  assert.equal(shoppingChecklist.hidden.length, 1);

  await page.goto(`${base}#/settings`);
  const downloaded = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download full backup', exact: true }).click();
  await (await downloaded).saveAs('.qa/full-backup/full-backup.json');
  const backup = JSON.parse(await fs.readFile('.qa/full-backup/full-backup.json', 'utf8'));
  assert.equal(backup.format, 'countertop-backup');
  assert.equal(backup.version, 1);
  assert.deepEqual(backup.state.recipes, recipes);
  assert.deepEqual(backup.state.favorites, [recipe.id]);
  assert.deepEqual(backup.state.shoppingChecklist, shoppingChecklist);
  assert.equal(backup.state.shoppingNotes[recipe.id], note);
  assert.equal(backup.state.sessions[recipe.id].status, 'running');

  // Replace the current browser data to demonstrate a real restore, not a no-op.
  await page.evaluate(({ prefix, other }) => {
    for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key);
    localStorage.setItem(prefix + 'recipes', JSON.stringify({ version: 1, value: [{ ...other, name: 'My changed collection' }] }));
    localStorage.setItem(prefix + 'theme', JSON.stringify({ version: 1, value: 'light' }));
    localStorage.setItem(prefix + 'shopping-notes', JSON.stringify({ version: 1, value: { [other.id]: 'This will be replaced.' } }));
  }, { prefix, other });
  await setRestoreFixture(page, other);
  await page.reload();
  const beforeRestore = await snapshot();
  await upload(backup);
  await expect(preview).toBeVisible();
  await expect(preview.getByRole('button', { name: 'Restore this backup', exact: true })).toBeDisabled();
  await expect(preview.getByRole('heading', { name: 'Bring your cookbook back.' })).toBeFocused();
  await expect(preview).toContainText('Your 1 current recipe');
  assert.deepEqual(await snapshot(), beforeRestore);
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Choose backup file', exact: true })).toBeFocused();
  assert.deepEqual(await snapshot(), beforeRestore);

  await upload(backup, `${'countertop-'.repeat(20)}full-backup.json`);
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(preview).toBeVisible();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Restore preview overflows at ${width}px`);
    assert.equal(await preview.evaluate(node => node.scrollWidth > node.clientWidth), false, `Restore preview content overflows at ${width}px`);
    await preview.screenshot({ path: `.qa/full-backup/preview-${width}.png` });
  }
  await preview.getByRole('checkbox', { name: 'Replace my current cookbook and progress', exact: true }).check();
  await expect(preview.getByRole('button', { name: 'Restore this backup', exact: true })).toBeEnabled();
  await preview.getByRole('button', { name: 'Restore this backup', exact: true }).click();
  await expect(page.getByText('Full cookbook restored. Saved cooking clocks and timers are paused; resume them when you are ready.', { exact: true })).toBeVisible();
  await expect(preview).toHaveCount(0);
  const expectedStored = {
    recipes: backup.state.recipes, favorites: backup.state.favorites, theme: backup.state.theme,
    'shopping-plan': backup.state.shoppingPlan, servings: backup.state.servings,
    'shopping-notes': backup.state.shoppingNotes, 'shopping-checklist': backup.state.shoppingChecklist,
    'dinner-timing': backup.state.dinnerTiming,
    [`ingredients:${recipe.id}`]: backup.state.ingredientChecks[recipe.id],
  };
  for (const [key, value] of Object.entries(expectedStored)) assert.deepEqual(await read(key), value, `${key} restored`);
  assert.equal(await page.evaluate(() => localStorage.getItem('another-app:keep')), 'untouched');
  assert.equal(await page.evaluate(prefix => localStorage.getItem(prefix + 'restore-journal'), prefix), null);
  const originalSession = backup.state.sessions[recipe.id];
  const elapsedSinceStart = Date.parse(backup.createdAt) - originalSession.startedAt;
  const restoredSession = await read(`session:${recipe.id}`);
  assert.deepEqual(restoredSession, { ...originalSession, status: 'paused', accumulatedMs: originalSession.accumulatedMs + elapsedSinceStart, startedAt: null, timers: { [timedStep.id]: { ...originalSession.timers[timedStep.id], status: 'paused', startedAt: null, remainingMs: originalSession.timers[timedStep.id].remainingMs - elapsedSinceStart } } });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto(`${base}#/recipe/${recipe.id}/overview`);
  await expect(page.getByRole('button', { name: 'Remove from favorites', exact: true })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Recipe servings', exact: true })).toHaveValue('8');
  await expect(page.locator('.shopping-note-text')).toHaveText(note);
  assert.equal(await page.locator('.shopping-note-text b').count(), 0);
  await page.goto(`${base}#/recipe/${recipe.id}/ingredients`);
  await expect(page.locator('.ingredient-check input').first()).toBeChecked();
  await page.goto(`${base}#/recipe/${recipe.id}/cook`);
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Cooking steps complete', exact: true })).toHaveAttribute('aria-valuenow', '1');
  await expect(page.getByRole('button', { name: `Resume timer for ${timedStep.title}`, exact: true }).first()).toBeVisible();
  const timerText = await page.locator('.cook-live-timer .cook-digits').textContent();
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('.cook-live-timer .cook-digits').textContent(), timerText, 'Restored timer remains paused');
  await page.goto(`${base}#/shopping`);
  assert.deepEqual(await page.locator('.shopping-item').allTextContents(), groceryRows);
  await expect(page.locator('.shopping-item input:checked')).toHaveCount(1);
  await expect(page.locator('.shopping-recipe-note p')).toHaveText(note);
  await page.goto(`${base}#/shopping/timing`);
  const expectedDinnerInput = await page.evaluate(serveAt => {
    const date = new Date(serveAt);
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }, backup.state.dinnerTiming.serveAt);
  await expect(page.locator('#dinner-serve-at')).toHaveValue(expectedDinnerInput);
  await page.reload();
  assert.deepEqual(await read(`session:${recipe.id}`), restoredSession);
  await expect(page.locator('#dinner-serve-at')).toHaveValue(expectedDinnerInput);

  await page.goto(`${base}#/settings`);
  const recipeDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export your cookbook/ }).click();
  await (await recipeDownload).saveAs('.qa/full-backup/recipes-only.json');
  assert.deepEqual(JSON.parse(await fs.readFile('.qa/full-backup/recipes-only.json', 'utf8')), { schemaVersion: 1, recipes });
  const beforeInvalid = await snapshot();
  for (const [invalid, message] of [
    [recipe, 'Recipe-only JSON files belong in Import recipes.'],
    [{ ...backup, version: 999 }, 'Unsupported or missing backup version'],
    ['{"format":', 'This is not valid JSON'],
    [{ ...backup, state: { ...backup.state, favorites: ['missing-recipe'] } }, 'Recipe reference does not exist'],
  ]) {
    await upload(invalid);
    await expect(panel.getByRole('alert')).toContainText(message);
    await expect(preview).toHaveCount(0);
    assert.deepEqual(await snapshot(), beforeInvalid, 'Rejected restore leaves all saved state unchanged');
  }

  // A failure to reserve the rollback journal must leave the cookbook intact.
  await upload(backup);
  await page.setViewportSize({ width: 390, height: 844 });
  await preview.screenshot({ path: '.qa/full-backup/preview-dark-phone.png' });
  await page.evaluate(prefix => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === prefix + 'restore-journal') throw new DOMException('Injected quota failure', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  }, prefix);
  await preview.getByRole('checkbox', { name: 'Replace my current cookbook and progress', exact: true }).check();
  await preview.getByRole('button', { name: 'Restore this backup', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Your current cookbook has not changed');
  assert.deepEqual(await snapshot(), beforeInvalid);
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked();

  // Simulate a browser closing during restore; startup must recover before reading React state.
  const beforeInterrupted = await snapshot();
  await page.evaluate(({ prefix, entries }) => {
    localStorage.setItem(prefix + 'restore-journal', JSON.stringify({ version: 1, entries: Object.entries(entries) }));
    localStorage.setItem(prefix + 'recipes', JSON.stringify({ version: 1, value: [] }));
    localStorage.removeItem(prefix + 'shopping-notes');
  }, { prefix, entries: beforeInterrupted });
  await page.reload();
  await expect(page.locator('.storage-warning')).toContainText('interrupted backup restore was rolled back');
  assert.deepEqual(await snapshot(), beforeInterrupted);

  // If writes stay unavailable after a journal was saved, stop editing partial data immediately.
  const beforePersistentFailure = await snapshot();
  await upload(backup);
  await page.evaluate(prefix => {
    const original = Storage.prototype.setItem;
    let storageFailed = false;
    Storage.prototype.setItem = function (key, value) {
      if (key === prefix + 'shopping-plan') storageFailed = true;
      if (storageFailed) throw new DOMException('Injected persistent write failure', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  }, prefix);
  await preview.getByRole('checkbox', { name: 'Replace my current cookbook and progress', exact: true }).check();
  await preview.getByRole('button', { name: 'Restore this backup', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your cookbook needs a moment.', exact: true })).toBeVisible();
  await expect(page.locator('.data-page')).toHaveCount(0);
  const retainedJournal = await page.evaluate(prefix => JSON.parse(localStorage.getItem(prefix + 'restore-journal')), prefix);
  assert.deepEqual(Object.fromEntries(retainedJournal.entries), beforePersistentFailure);
  await page.getByRole('button', { name: 'Retry cookbook recovery', exact: true }).click();
  await expect(page.locator('.data-page')).toBeVisible();
  await expect(page.locator('.storage-warning')).toContainText('interrupted backup restore was rolled back');
  assert.deepEqual(await snapshot(), beforePersistentFailure);

  // A damaged recovery journal can be saved raw before a deliberately confirmed reset.
  await page.evaluate(prefix => localStorage.setItem(prefix + 'restore-journal', '{damaged recovery journal'), prefix);
  const damagedSnapshot = await snapshot();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your cookbook needs a moment.', exact: true })).toBeVisible();
  await expect(page.locator('.data-page')).toHaveCount(0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Recovery screen stays within phone width');
  await page.screenshot({ path: '.qa/full-backup/recovery-phone.png', fullPage: true });
  const rawRecoveryDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save recovery data', exact: true }).click();
  await (await rawRecoveryDownload).saveAs('.qa/full-backup/recovery-raw.json');
  const rawRecovery = JSON.parse(await fs.readFile('.qa/full-backup/recovery-raw.json', 'utf8'));
  assert.equal(rawRecovery.format, 'countertop-recovery');
  assert.equal(rawRecovery.version, 1);
  assert.deepEqual(Object.fromEntries(rawRecovery.entries), damagedSnapshot);
  assert.equal(Object.fromEntries(rawRecovery.entries)['another-app:keep'], undefined);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Start fresh with sample recipes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your cookbook needs a moment.', exact: true })).toBeVisible();
  assert.deepEqual(await snapshot(), damagedSnapshot, 'Canceling recovery reset preserves every saved entry');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Start fresh with sample recipes', exact: true }).click();
  await expect(page.locator('.data-page')).toBeVisible();
  await expect(page.getByRole('button', { name: `Remove ${recipe.name}`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Remove ${other.name}`, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Italian Sausage & Peppers', exact: true })).toBeVisible();
  assert.equal(await page.evaluate(prefix => localStorage.getItem(prefix + 'restore-journal'), prefix), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('another-app:keep')), 'untouched');
  assert.deepEqual(errors, []);
  console.log('PASS: full-backup export/restore, all saved state, frozen sessions/timers, confirmation/cancel, invalid JSON/version/references, recipe-only export, unrelated storage, quota refusal, interrupted-restore recovery, persistent-failure blocking/retry, raw recovery export and confirmed reset, refresh, and responsive light/dark previews at 360/390/768/1280px.');
} finally {
  await browser.close();
}
