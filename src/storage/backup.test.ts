import { describe, expect, it } from 'vitest';
import { sampleRecipes } from '../data';
import { createFullBackup, recoverInterruptedRestore, RESTORE_JOURNAL_KEY, restoreFullBackup, type CurrentCookbook } from './backup';
import { STORAGE_PREFIX } from './persistence';
import { freshSession } from '../features/cooking/session';

class MemoryStorage {
  values = new Map<string, string>();
  fail: (key: string, value: string) => boolean = () => false;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.fail(key, value)) throw new Error('Storage unavailable');
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}
const recipe = sampleRecipes[0];
const now = new Date('2026-11-06T12:00:00.000Z');
const current = (): CurrentCookbook => ({ recipes: sampleRecipes, favorites: [recipe.id], theme: 'dark', shoppingPlan: [{ recipeId: recipe.id, servings: 6 }], servings: { [recipe.id]: 6 }, shoppingNotes: { [recipe.id]: 'Buy the GF brand.' } });
const save = (storage: MemoryStorage, key: string, value: unknown) => storage.setItem(STORAGE_PREFIX + key, JSON.stringify({ version: 1, value }));
const load = (storage: MemoryStorage, key: string) => JSON.parse(storage.getItem(STORAGE_PREFIX + key)!).value;

describe('full cookbook storage transactions', () => {
  it('backs up first-launch samples and current in-memory changes without needing stored recipes', () => {
    const backup = createFullBackup(current(), new MemoryStorage(), now);
    expect(backup.state.recipes).toEqual(sampleRecipes);
    expect(backup.state.shoppingNotes).toEqual(current().shoppingNotes);
    expect(backup.state.ingredientChecks).toEqual({});
    expect(backup.state.dinnerTiming).toBeNull();
  });

  it('snapshots independent progress and removes stale references without mutating storage', () => {
    const storage = new MemoryStorage();
    save(storage, `ingredients:${recipe.id}`, [recipe.ingredients[0].id, 'removed-ingredient']);
    save(storage, `session:${recipe.id}`, freshSession(recipe.events[0].id));
    save(storage, 'dinner-timing', { serveAt: now.getTime() });
    save(storage, 'shopping-checklist', { checked: ['stale-item'], hidden: ['stale-item'] });
    const before = [...storage.values];
    const backup = createFullBackup({ ...current(), servings: { 'removed-recipe': 4, [recipe.id]: 6 } }, storage, now);
    expect(backup.state.ingredientChecks[recipe.id]).toEqual([recipe.ingredients[0].id]);
    expect(backup.state.sessions[recipe.id]).toEqual(freshSession(recipe.events[0].id));
    expect(backup.state.shoppingChecklist).toEqual({ checked: [], hidden: [] });
    expect(backup.state.servings).toEqual({ [recipe.id]: 6 });
    expect([...storage.values]).toEqual(before);
  });

  it('does not quietly omit unreadable saved progress from a full backup', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_PREFIX + `session:${recipe.id}`, '{bad json');
    expect(() => createFullBackup(current(), storage, now)).toThrow(`saved session:${recipe.id}`);
  });

  it('replaces only Countertop data, removes obsolete progress, and freezes running clocks', () => {
    const source = new MemoryStorage();
    const event = recipe.events.find(step => step.timerMinutes)!;
    save(source, `session:${recipe.id}`, { ...freshSession(event.id), status: 'running', startedAt: now.getTime() - 15_000, accumulatedMs: 5000, timers: { [event.id]: { status: 'running', startedAt: now.getTime() - 15_000, durationMs: 60_000, remainingMs: 60_000 } } });
    const backup = createFullBackup(current(), source, now);
    const target = new MemoryStorage();
    target.setItem('another-app:data', 'keep me');
    save(target, 'session:obsolete-recipe', { old: true });
    restoreFullBackup(backup, target);
    expect(load(target, 'recipes')).toEqual(sampleRecipes);
    expect(load(target, 'shopping-notes')).toEqual(current().shoppingNotes);
    expect(load(target, `session:${recipe.id}`)).toMatchObject({ status: 'paused', startedAt: null, accumulatedMs: 20_000, timers: { [event.id]: { status: 'paused', remainingMs: 45_000, startedAt: null } } });
    expect(target.getItem('another-app:data')).toBe('keep me');
    expect(target.getItem(STORAGE_PREFIX + 'session:obsolete-recipe')).toBeNull();
    expect(target.getItem(RESTORE_JOURNAL_KEY)).toBeNull();
  });

  it('rejects invalid input before touching storage', () => {
    const storage = new MemoryStorage();
    save(storage, 'recipes', []);
    const backup = createFullBackup(current(), new MemoryStorage(), now);
    backup.state.shoppingPlan.push({ recipeId: 'unknown-recipe', servings: 1 });
    const before = [...storage.values];
    expect(() => restoreFullBackup(backup, storage)).toThrow();
    expect([...storage.values]).toEqual(before);
  });

  it('requires enough room for a rollback journal before changing any data', () => {
    const storage = new MemoryStorage();
    save(storage, 'recipes', []);
    storage.fail = key => key === RESTORE_JOURNAL_KEY;
    const before = [...storage.values];
    expect(() => restoreFullBackup(createFullBackup(current(), new MemoryStorage(), now), storage)).toThrow('current cookbook has not changed');
    expect([...storage.values]).toEqual(before);
  });

  it('rolls back an interrupted write exactly, including previously malformed saved data', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_PREFIX + 'recipes', '{corrupted original data');
    save(storage, 'theme', 'light');
    storage.setItem('other:key', 'untouched');
    const before = [...storage.values].sort();
    let failed = false;
    storage.fail = key => {
      if (!failed && key === STORAGE_PREFIX + 'shopping-plan') { failed = true; return true; }
      return false;
    };
    expect(() => restoreFullBackup(createFullBackup(current(), new MemoryStorage(), now), storage)).toThrow('previous cookbook was restored');
    expect([...storage.values].sort()).toEqual(before);
  });

  it('retains recovery data if access fails during rollback and recovers before app startup', () => {
    const storage = new MemoryStorage();
    save(storage, 'recipes', []);
    save(storage, 'theme', 'light');
    let denied = false;
    storage.fail = key => {
      if (key === STORAGE_PREFIX + 'shopping-plan') denied = true;
      return denied;
    };
    expect(() => restoreFullBackup(createFullBackup(current(), new MemoryStorage(), now), storage)).toThrow('Recovery data has been retained');
    expect(storage.getItem(RESTORE_JOURNAL_KEY)).not.toBeNull();
    storage.fail = () => false;
    expect(recoverInterruptedRestore(storage)).toBe('recovered');
    expect(load(storage, 'recipes')).toEqual([]);
    expect(load(storage, 'theme')).toBe('light');
    expect(storage.getItem(RESTORE_JOURNAL_KEY)).toBeNull();
  });

  it('rolls back a journal left by a closed tab and never applies keys outside the app namespace', () => {
    const storage = new MemoryStorage();
    save(storage, 'recipes', sampleRecipes);
    storage.setItem(RESTORE_JOURNAL_KEY, JSON.stringify({ version: 1, entries: [[STORAGE_PREFIX + 'recipes', JSON.stringify({ version: 1, value: [] })]] }));
    expect(recoverInterruptedRestore(storage)).toBe('recovered');
    expect(load(storage, 'recipes')).toEqual([]);
    storage.setItem(RESTORE_JOURNAL_KEY, JSON.stringify({ version: 1, entries: [['another-app:data', 'overwrite']] }));
    expect(recoverInterruptedRestore(storage)).toBe('failed');
    expect(storage.getItem('another-app:data')).toBeNull();
    expect(load(storage, 'recipes')).toEqual([]);
  });

  it('keeps an intentionally empty cookbook empty after restore', () => {
    const storage = new MemoryStorage();
    const backup = createFullBackup({ ...current(), recipes: [] }, new MemoryStorage(), now);
    restoreFullBackup(backup, storage);
    expect(load(storage, 'recipes')).toEqual([]);
    expect(load(storage, 'favorites')).toEqual([]);
    expect(load(storage, 'shopping-notes')).toEqual({});
  });
});
