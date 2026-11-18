import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readStored, writeStored } from './persistence';

describe('resilient versioned storage', () => {
  it('starts safely with corrupted JSON', () => {
    const storage = { getItem: () => '{broken', setItem: () => {}, removeItem: () => {} };
    expect(readStored('recipes', z.array(z.string()), ['sample'], storage)).toEqual(['sample']);
  });
  it('recovers invalid values and unsupported storage versions', () => {
    for (const raw of ['{"version":1,"value":42}', '{"version":999,"value":[]}']) {
      expect(readStored('recipes', z.array(z.string()), ['sample'], {getItem:()=>raw,setItem:()=>{},removeItem:()=>{}})).toEqual(['sample']);
    }
  });
  it('handles quota and access failures without throwing', () => {
    const storage = {getItem:()=>{throw new Error('denied');},setItem:()=>{throw new Error('quota');},removeItem:()=>{}};
    expect(readStored('favorites', z.array(z.string()), [], storage)).toEqual([]);
    expect(writeStored('favorites', ['dinner'], storage)).toBe(false);
  });
  it('preserves intentionally empty collections', () => {
    expect(readStored('recipes', z.array(z.string()), ['sample'], {getItem:()=>'{"version":1,"value":[]}',setItem:()=>{},removeItem:()=>{}})).toEqual([]);
  });
});
