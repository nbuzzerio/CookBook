import type { ShoppingItem } from '../../domain/shopping';

export interface ShoppingChecklist {
  checked: string[];
  hidden: string[];
}

/** Completion describes a particular requirement, not just an ingredient's identity. */
export function shoppingCompletionKey(item: ShoppingItem): string {
  return JSON.stringify([
    item.key,
    item.quantity === undefined ? null : Number(item.quantity.toPrecision(12)),
    item.name,
    item.optional,
    [...item.preparations].sort(),
  ]);
}

/** Remove obsolete completions so reverting a quantity cannot resurrect a stale check. */
export function reconcileShoppingChecklist(checklist: ShoppingChecklist, currentKeys: ReadonlySet<string>): ShoppingChecklist {
  const checked = checklist.checked.filter(key => currentKeys.has(key));
  const checkedKeys = new Set(checked);
  const hidden = checklist.hidden.filter(key => currentKeys.has(key) && checkedKeys.has(key));
  return checked.length === checklist.checked.length && hidden.length === checklist.hidden.length
    ? checklist
    : { checked, hidden };
}
