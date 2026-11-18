import { z, type ZodType } from 'zod';
import { backupSchema, backupStateSchema, normalizeBackupState, pauseBackupSessions, serializeBackup, type BackupState, type CookbookBackup } from '../domain/backup';
import { STORAGE_PREFIX, reportStorageWarning } from './persistence';

type BackupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
export type CurrentCookbook = Pick<BackupState, 'recipes' | 'favorites' | 'theme' | 'shoppingPlan' | 'servings' | 'shoppingNotes'>;
export const RESTORE_JOURNAL_KEY = `${STORAGE_PREFIX}restore-journal`;
export class RestoreRecoveryRequired extends Error {}
const journalSchema = z.object({
  version: z.literal(1),
  entries: z.array(z.tuple([
    z.string().startsWith(STORAGE_PREFIX).refine(key => key !== RESTORE_JOURNAL_KEY),
    z.string(),
  ])).max(5000),
}).strict();

function ownedEntries(storage: BackupStorage): [string, string][] {
  const entries: [string, string][] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key?.startsWith(STORAGE_PREFIX) && key !== RESTORE_JOURNAL_KEY) {
      const value = storage.getItem(key);
      if (value !== null) entries.push([key, value]);
    }
  }
  return entries;
}

function readValue<T>(storage: BackupStorage, key: string, schema: ZodType<T>, fallback: T): T {
  const raw = storage.getItem(STORAGE_PREFIX + key);
  if (raw === null) return fallback;
  try {
    return z.object({ version: z.literal(1), value: schema }).parse(JSON.parse(raw)).value;
  } catch {
    throw new Error(`The saved ${key} data could not be read. A full backup was not created. You can still export your recipes separately.`);
  }
}

/** Include current collection/preferences and independently saved recipe progress. */
export function createFullBackup(current: CurrentCookbook, storage: BackupStorage = window.localStorage, now = new Date()): CookbookBackup {
  const fields = backupStateSchema.shape;
  const ingredientChecks: BackupState['ingredientChecks'] = {};
  const sessions: BackupState['sessions'] = {};
  for (const recipe of current.recipes) {
    const checks = readValue(storage, `ingredients:${recipe.id}`, z.array(z.string()), []);
    if (checks.length) ingredientChecks[recipe.id] = checks;
    const session = readValue(storage, `session:${recipe.id}`, fields.sessions.valueType.nullable(), null);
    if (session) sessions[recipe.id] = session;
  }
  const state = normalizeBackupState({
    ...current,
    ingredientChecks,
    sessions,
    shoppingChecklist: readValue(storage, 'shopping-checklist', fields.shoppingChecklist, { checked: [], hidden: [] }),
    dinnerTiming: readValue(storage, 'dinner-timing', fields.dinnerTiming, null),
  });
  const backup = backupSchema.parse({ format: 'countertop-backup', version: 1, createdAt: now.toISOString(), state });
  serializeBackup(backup); // Apply the file-size limit before offering a download.
  return backup;
}

function entriesForBackup(backup: CookbookBackup): [string, string][] {
  const state = backup.state;
  const values: [string, unknown][] = [
    ['recipes', state.recipes], ['favorites', state.favorites], ['theme', state.theme],
    ['shopping-plan', state.shoppingPlan], ['servings', state.servings],
    ['shopping-notes', state.shoppingNotes], ['shopping-checklist', state.shoppingChecklist],
    ...Object.entries(state.ingredientChecks).map(([id, value]): [string, unknown] => [`ingredients:${id}`, value]),
    ...Object.entries(state.sessions).map(([id, value]): [string, unknown] => [`session:${id}`, value]),
  ];
  if (state.dinnerTiming) values.push(['dinner-timing', state.dinnerTiming]);
  return values.map(([key, value]) => [STORAGE_PREFIX + key, JSON.stringify({ version: 1, value })]);
}

function replaceEntries(storage: BackupStorage, entries: [string, string][]): void {
  for (const [key] of ownedEntries(storage)) storage.removeItem(key);
  for (const [key, value] of entries) storage.setItem(key, value);
}

/** Keep a rollback journal until the entire namespace has been written successfully. */
export function restoreFullBackup(input: CookbookBackup, storage: BackupStorage = window.localStorage): void {
  const backup = pauseBackupSessions(backupSchema.parse(input));
  serializeBackup(backup);
  if (storage.getItem(RESTORE_JOURNAL_KEY) !== null) {
    throw new RestoreRecoveryRequired('An earlier restore needs recovery. Reload Countertop before restoring another backup.');
  }
  const original = ownedEntries(storage);
  const journal = JSON.stringify(journalSchema.parse({ version: 1, entries: original }));
  try { storage.setItem(RESTORE_JOURNAL_KEY, journal); }
  catch { throw new Error('There is not enough available browser storage to restore safely. Your current cookbook has not changed. Free some browser storage or restore in another browser.'); }
  try {
    replaceEntries(storage, entriesForBackup(backup));
    storage.removeItem(RESTORE_JOURNAL_KEY);
  } catch {
    try {
      replaceEntries(storage, original);
      storage.removeItem(RESTORE_JOURNAL_KEY);
    } catch {
      throw new RestoreRecoveryRequired('Browser storage became unavailable during restore. Recovery data has been retained. Reload Countertop to recover your previous cookbook before making more changes.');
    }
    throw new Error('The backup could not fit in browser storage or storage became unavailable. Your previous cookbook was restored; no changes were kept.');
  }
}

/** Run before React reads any saved state. An unfinished transaction always rolls back. */
export function recoverInterruptedRestore(storage?: BackupStorage): 'none' | 'recovered' | 'failed' {
  let target: BackupStorage;
  let raw: string | null;
  try {
    target = storage ?? window.localStorage;
    raw = target.getItem(RESTORE_JOURNAL_KEY);
  } catch { return 'none'; } // Normal unavailable-storage handling belongs to the persistence layer.
  if (raw === null) return 'none';
  try {
    const journal = journalSchema.parse(JSON.parse(raw));
    replaceEntries(target, journal.entries);
    target.removeItem(RESTORE_JOURNAL_KEY);
    reportStorageWarning('An interrupted backup restore was rolled back. Your previous cookbook is available.');
    return 'recovered';
  } catch {
    return 'failed';
  }
}
