import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ZodType } from 'zod';
import { readStored, writeStored } from './persistence';

export function usePersistentState<T>(key: string, schema: Pick<ZodType<T>, 'safeParse'>, fallback: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [state, update] = useState<T>(() => readStored(key, schema, typeof fallback === 'function' ? (fallback as () => T)() : fallback));
  const latest = useRef(state);
  const setState = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const resolved = typeof next === 'function' ? (next as (previous: T) => T)(latest.current) : next;
    latest.current = resolved;
    writeStored(key, resolved);
    update(resolved);
  }, [key]);
  return [state, setState];
}
