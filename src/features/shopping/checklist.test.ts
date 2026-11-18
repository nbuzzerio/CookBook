import { describe, expect, it } from 'vitest';
import type { ShoppingItem } from '../../domain/shopping';
import { reconcileShoppingChecklist, shoppingCompletionKey } from './checklist';

const item: ShoppingItem = {
  key: '["onion","","number",""]',
  name: 'Onion', quantity: 2, unit: '', preparations: ['Diced'],
  optional: false, groceryCategory: 'Produce', sources: ['Dinner'],
};

describe('shopping completion requirements', () => {
  it('unchecks and unhides an ingredient when a larger recipe plan needs more', () => {
    const oldKey = shoppingCompletionKey(item);
    const newKey = shoppingCompletionKey({ ...item, quantity: 4 });
    const next = reconcileShoppingChecklist({ checked: [oldKey], hidden: [oldKey] }, new Set([newKey]));
    expect(next).toEqual({ checked: [], hidden: [] });
    // Returning to an earlier amount cannot resurrect a completion that was invalidated.
    expect(reconcileShoppingChecklist(next, new Set([oldKey]))).toEqual({ checked: [], hidden: [] });
  });

  it('preserves a check when recipe order changes but the requirement does not', () => {
    const original = { ...item, quantity: 0.1 + 0.2, preparations: ['Diced', 'Finely chopped'] };
    const reordered = { ...original, quantity: 0.3, preparations: ['Finely chopped', 'Diced'], sources: ['Other dinner', 'Dinner'] };
    expect(shoppingCompletionKey(original)).toBe(shoppingCompletionKey(reordered));
    const key = shoppingCompletionKey(original);
    const checklist = { checked: [key], hidden: [key] };
    expect(reconcileShoppingChecklist(checklist, new Set([shoppingCompletionKey(reordered)]))).toBe(checklist);
  });

  it('invalidates checks when optionality, preparation, or ingredient identity changes', () => {
    const key = shoppingCompletionKey(item);
    expect(shoppingCompletionKey({ ...item, optional: true })).not.toBe(key);
    expect(shoppingCompletionKey({ ...item, preparations: ['Sliced'] })).not.toBe(key);
    expect(shoppingCompletionKey({ ...item, key: 'other-ingredient' })).not.toBe(key);
  });

  it('prunes removed items, legacy identity-only checks, and hidden items without completion', () => {
    const key = shoppingCompletionKey(item);
    expect(reconcileShoppingChecklist({ checked: [item.key, 'removed'], hidden: [key] }, new Set([key]))).toEqual({ checked: [], hidden: [] });
  });
});
