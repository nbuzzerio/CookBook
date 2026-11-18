import { z } from 'zod';
import { sampleRecipes } from '../data';
import { recipeSchema, type Recipe } from '../domain/schema';
import { parseBackup, serializeBackup, type CookbookBackup } from '../domain/backup';
import { shoppingNotesSchema } from '../domain/shoppingNotes';
import { recoverInterruptedRestore, LIBRARY_GENERATION_KEY, RESTORE_JOURNAL_KEY, replaceDeviceEntries, restoreFullBackup, RestoreRecoveryRequired } from '../storage/backup';
import { reportStorageWarning, STORAGE_PREFIX } from '../storage/persistence';
import { editRecipes, fresh, stageAgain, type Cookbook, type Scope } from './model';
import { same } from './protocol';

const request = <T,>(r: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
let opening: Promise<IDBDatabase> | undefined;
function database() {
  if (!opening) {
    const r = indexedDB.open('countertop-personal-sync', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('library'); r.result.createObjectStore('recovery'); };
    opening = request(r);
  }
  return opening;
}
async function transaction<T>(mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>) {
  const db = await database();
  const tx = db.transaction(['library', 'recovery'], mode, { durability: 'strict' });
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('The browser interrupted the save.'));
  });
  try { const value = await work(tx); await done; return value; }
  catch (error) { try { tx.abort(); } catch { /* Already finished. */ } await done.catch(() => {}); throw error; }
}
const read = (tx: IDBTransaction) => request<Cookbook | undefined>(tx.objectStore('library').get('current'));
let current: Cookbook;
const listeners = new Set<() => void>();
export const snapshot = () => current;
export const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function publish(s: Cookbook) {
  if (current && current.revision >= s.revision) return;
  current = s;
  listeners.forEach(fn => fn());
}
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('countertop-library-v1') : null;
channel?.addEventListener('message', () => { void refresh().catch(e => reportStorageWarning(String(e))); });
export async function refresh() { const s = await transaction('readonly', read); if (s) publish(s); return s; }
export function rawStorage(): [string, string][] {
  return Object.keys(localStorage).filter(key => key.startsWith(STORAGE_PREFIX)).sort().map(key => [key, localStorage.getItem(key)!]);
}
function protectCopy(tx: IDBTransaction, reason: string, state: Cookbook) {
  tx.objectStore('recovery').add({ reason, state: structuredClone(state), entries: rawStorage(), savedAt: Date.now() }, crypto.randomUUID());
}
export async function change(work: (s: Cookbook) => void, archive?: string) {
  const s = await transaction('readwrite', async tx => {
    const state = await read(tx);
    if (!state) throw new Error('Local storage is unavailable. Reopen Countertop before saving.');
    if (localStorage.getItem(RESTORE_JOURNAL_KEY) !== null) throw new RestoreRecoveryRequired('Reload to recover the interrupted cookbook restore.');
    if (archive) protectCopy(tx, archive, state);
    work(state);
    state.revision++;
    await request(tx.objectStore('library').put(state, 'current'));
    return state;
  });
  publish(s); channel?.postMessage('changed');
}
export const syncLock = async <T,>(fn: () => Promise<T>) => {
  if (!navigator.locks) throw new Error('This browser needs Web Locks for safe shared sync.');
  return navigator.locks.request('countertop-sync-v1', fn);
};
export function hasProgress(id: string) {
  const plan = localStorage.getItem(STORAGE_PREFIX + 'shopping-plan');
  return !!(localStorage.getItem(STORAGE_PREFIX + 'session:' + id) || localStorage.getItem(STORAGE_PREFIX + 'ingredients:' + id) || plan?.includes(JSON.stringify(id)));
}
type Migration = { entries: [string, string][]; samples: Recipe[]; format: 'countertop-migration'; version: 1 };
function migrate(copy: Migration) {
  const s = fresh();
  const entries = Object.fromEntries(copy.entries);
  function value(key: string): unknown {
    const envelope = JSON.parse(entries[STORAGE_PREFIX + key]);
    if (envelope.version !== 1) throw new Error('Unknown storage version');
    return envelope.value;
  }
  const problems: string[] = [];
  s.recipes = copy.samples;
  if (Object.hasOwn(entries, STORAGE_PREFIX + 'recipes')) {
    try {
      const arr = value('recipes');
      if (!Array.isArray(arr)) throw new Error();
      const valid = arr.filter(r => recipeSchema.safeParse(r).success) as Recipe[];
      s.recipes = [...new Map(valid.map(r => [r.id, r])).values()];
      if (s.recipes.length !== arr.length) problems.push('recipes');
    } catch { problems.push('recipes'); }
  }
  if (Object.hasOwn(entries, STORAGE_PREFIX + 'shopping-notes')) {
    try {
      const notes = value('shopping-notes');
      if (!notes || typeof notes !== 'object' || Array.isArray(notes)) throw new Error();
      for (const [id, note] of Object.entries(notes)) {
        const parsed = shoppingNotesSchema.safeParse({ [id]: note });
        if (parsed.success) Object.assign(s.privateNotes, parsed.data);
        else if (!problems.includes('shopping notes')) problems.push('shopping notes');
      }
    }
    catch { problems.push('shopping notes'); }
  }
  if (problems.length) s.migrationWarning = 'Some saved ' + problems.join(' and ') + ' could not be read. The original storage is retained. Download the migration copy in Advanced sync settings for recovery.';
  return s;
}
export async function initialize() {
  const init = async () => {
    const existing = await refresh();
    if (recoverInterruptedRestore(undefined, existing?.restoreId) === 'failed') throw new RestoreRecoveryRequired();
    if (existing) return;
    let entries: [string, string][];
    try { entries = rawStorage(); }
    catch {
      // Show sample recipes without committing an empty migration over inaccessible legacy data.
      current = fresh();
      reportStorageWarning('Browser storage is unavailable. Allow storage to save recipes and connect to sync.');
      return;
    }
    const copy: Migration = { format: 'countertop-migration', version: 1, entries, samples: sampleRecipes };
    await transaction('readwrite', async tx => {
      const backups = tx.objectStore('recovery');
      const previous = await request<Migration | undefined>(backups.get('migration'));
      if (previous && !same(previous, copy)) await request(backups.add(previous, crypto.randomUUID()));
      await request(backups.put(copy, 'migration'));
    });
    await transaction('readwrite', async tx => {
      if (await read(tx)) return;
      const saved = await request<Migration>(tx.objectStore('recovery').get('migration'));
      const verified = JSON.parse(JSON.stringify(saved)) as Migration;
      if (!same(copy, verified) || !z.array(z.tuple([z.string(), z.string()])).safeParse(saved.entries).success) throw new Error('The migration recovery copy could not be verified.');
      const state = migrate(verified);
      await request(tx.objectStore('library').add(state, 'current'));
      if (!same(state, await read(tx))) throw new Error('The migrated cookbook could not be verified.');
    });
    await refresh();
  };
  if (navigator.locks) await navigator.locks.request('countertop-restore-v1', init); else await init();
  if (current.migrationWarning) reportStorageWarning(current.migrationWarning);
}
export function assertLibrary(s: Cookbook, expected: Cookbook) {
  if (!same(s.scope, expected.scope) || s.restoreId !== expected.restoreId) throw new Error('The active cookbook changed. Review the current library and try again.');
}
export async function saveRecipes(expected: Cookbook, after: Recipe[]) {
  const before = expected.recipes;
  const replacing = before.some(r => {
    const replacement = after.find(item => item.id === r.id);
    return !replacement || !same(r, replacement);
  });
  await change(s => { assertLibrary(s, expected); editRecipes(s, before, after); }, replacing ? 'Before recipe replacement or removal' : undefined);
}
export async function preserveDamagedRestore() {
  await transaction('readwrite', async tx => {
    const state = await read(tx);
    if (state) protectCopy(tx, 'Before resetting damaged restore journal', state);
  });
}
export async function recoveryExport() {
  return transaction('readonly', async tx => ({
    format: 'countertop-sync-recovery', version: 1, state: await read(tx), entries: rawStorage(),
    copies: await request(tx.objectStore('recovery').getAll()),
    otherSpaces: (await request(tx.objectStore('library').getAll())).filter(value => value && 'state' in value),
  }));
}
export function downloadJson(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function resetBackup(): CookbookBackup {
  return { format: 'countertop-backup', version: 1, createdAt: new Date().toISOString(), state: {
    recipes: sampleRecipes, favorites: [], theme: 'system', shoppingPlan: [], servings: {}, shoppingNotes: {},
    ingredientChecks: {}, sessions: {}, shoppingChecklist: { checked: [], hidden: [] }, dinnerTiming: null,
  } };
}
async function finishDeviceChange(work: (id: string) => Promise<void>) {
  const id = crypto.randomUUID();
  try {
    await work(id);
    localStorage.removeItem(RESTORE_JOURNAL_KEY);
  } catch (error) {
    if (error instanceof RestoreRecoveryRequired) throw error;
    const state = await refresh();
    if (recoverInterruptedRestore(undefined, state?.restoreId) === 'failed') throw new RestoreRecoveryRequired();
    throw error;
  }
}
type Parked = { state: Cookbook; entries: [string, string][] };
const scopeKey = (scope: Scope) => [scope.owner, scope.appId, scope.spaceId];
export async function switchLibrary(expected: Cookbook, scope: Scope) {
  // The caller holds the sync lock. The migration lock also excludes startup recovery.
  await navigator.locks.request('countertop-restore-v1', () => finishDeviceChange(async id => {
    const next = await transaction('readwrite', async tx => {
      const previous = await read(tx);
      if (!previous?.scope || previous.scope.owner !== scope.owner) throw new Error('Choose a Space belonging to the current household.');
      assertLibrary(previous, expected);
      const libraries = tx.objectStore('library');
      const destination = await request<Parked | undefined>(libraries.get(scopeKey(scope)));
      const entries = rawStorage();
      const theme = STORAGE_PREFIX + 'theme';
      const forSpace = ([key]: [string, string]) => ![theme, LIBRARY_GENERATION_KEY, RESTORE_JOURNAL_KEY, STORAGE_PREFIX + 'recipes', STORAGE_PREFIX + 'shopping-notes'].includes(key);
      const state = destination?.state ?? fresh();
      if (!destination) { state.device = previous.device; state.scope = scope; stageAgain(state); }
      if (!same(state.scope, scope) || state.device !== previous.device) throw new Error('The saved Space binding could not be verified.');
      await request(libraries.put({ state: previous, entries: entries.filter(forSpace) } satisfies Parked, scopeKey(previous.scope)));
      replaceDeviceEntries([...(destination?.entries ?? []), ...entries.filter(([key]) => key === theme)], localStorage, id);
      state.restoreId = id; state.revision = previous.revision + 1;
      await request(libraries.put(state, 'current'));
      if (destination) await request(libraries.delete(scopeKey(scope)));
      return state;
    });
    publish(next); channel?.postMessage('changed');
  }));
}
export async function replaceFromBackup(input: CookbookBackup) {
  const backup = parseBackup(serializeBackup(input));
  const expected = snapshot();
  const apply = () => finishDeviceChange(async id => {
    await change(s => {
      assertLibrary(s, expected);
      restoreFullBackup(backup, localStorage, id);
      s.restoreId = id;
      s.recipes = backup.state.recipes; s.privateNotes = backup.state.shoppingNotes;
      s.sharedNotes = {}; s.shareNotes = []; s.privateRecipes = [];
      if (s.scope) stageAgain(s);
    }, 'Before full cookbook replacement');
  });
  if (navigator.locks) await syncLock(() => navigator.locks.request('countertop-restore-v1', apply)); else await apply();
}
