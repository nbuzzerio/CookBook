import type { ZodType } from 'zod';

export const STORAGE_PREFIX = 'countertop:v1:';
type Validator<T> = Pick<ZodType<T>, 'safeParse'>;
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
let warning = '';
const listeners = new Set<() => void>();
export const storageWarning = () => warning;
export const subscribeStorage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function report(message: string) { warning = message; listeners.forEach(listener => listener()); }
export const reportStorageWarning = report;
function browserStorage(): StorageLike | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; }
  catch { report('Browser storage is unavailable. Changes work for this visit; export your cookbook before leaving.'); return undefined; }
}
export function readStored<T>(key: string, schema: Validator<T>, fallback: T, storage: StorageLike | undefined = browserStorage()): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(STORAGE_PREFIX + key);
    if (raw === null) return fallback;
    const envelope: unknown = JSON.parse(raw);
    if (!envelope || typeof envelope !== 'object' || !('version' in envelope) || envelope.version !== 1 || !('value' in envelope)) throw new Error('Unsupported stored data');
    const result = schema.safeParse(envelope.value);
    if (!result.success) throw new Error('Invalid stored data');
    return result.data;
  } catch {
    report('Some saved data could not be read. A safe default is shown. Your other lists are preserved; import a backup to restore recipes.');
    return fallback;
  }
}
export function writeStored<T>(key: string, value: T, storage: StorageLike | undefined = browserStorage()): boolean {
  if (!storage) return false;
  try { storage.setItem(STORAGE_PREFIX + key, JSON.stringify({ version: 1, value })); return true; }
  catch { report('Your changes could not be saved to this browser. Storage may be full or unavailable. Export your cookbook before leaving.'); return false; }
}
export function removeStored(key: string): void {
  try { browserStorage()?.removeItem(STORAGE_PREFIX + key); }
  catch { report('Some old recipe progress could not be removed from browser storage.'); }
}
export function resetStorage(): boolean {
  try {
    const storage = window.localStorage;
    Object.keys(storage).filter(key => key.startsWith(STORAGE_PREFIX)).forEach(key => storage.removeItem(key));
    return true;
  } catch { report('Browser storage could not be cleared. You can still export your cookbook.'); return false; }
}
