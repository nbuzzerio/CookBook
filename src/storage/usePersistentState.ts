import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ZodType } from 'zod';
import { LIBRARY_GENERATION_KEY } from './backup';
import { readStored, reportStorageWarning, writeStored } from './persistence';

export function usePersistentState<T>(key: string, schema: Pick<ZodType<T>, 'safeParse'>, fallback: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [state, update] = useState<T>(() => readStored(key, schema, typeof fallback === 'function' ? (fallback as () => T)() : fallback));
  const [generation] = useState(() => {
    try { return window.localStorage.getItem(LIBRARY_GENERATION_KEY); } catch { return null; }
  });
  const latest = useRef(state);
  const setState = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    try {
      if (window.localStorage.getItem(LIBRARY_GENERATION_KEY) !== generation) {
        reportStorageWarning('The active cookbook changed in another tab. Reopen this view before saving progress.');
        return;
      }
    } catch { /* writeStored reports unavailable storage. */ }
    const resolved = typeof next === 'function' ? (next as (previous: T) => T)(latest.current) : next;
    latest.current = resolved;
    writeStored(key, resolved);
    update(resolved);
  }, [key, generation]);
  return [state, setState];
}
