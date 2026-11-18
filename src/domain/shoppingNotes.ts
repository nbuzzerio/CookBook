import { z } from 'zod';
import { recipeSchema } from './schema';

export const SHOPPING_NOTE_LIMIT = 500;
export const shoppingNotesSchema = z.record(
  recipeSchema.shape.id,
  z.string().trim().min(1).max(SHOPPING_NOTE_LIMIT),
).refine(notes => Object.keys(notes).length <= 500, 'Shopping notes support up to 500 recipes.');
export type ShoppingNotes = z.infer<typeof shoppingNotesSchema>;

/** Reminders are independent annotations; recipe ingredients remain untouched. */
export function updateShoppingNote(notes: ShoppingNotes, recipeId: string, value: string): ShoppingNotes {
  recipeSchema.shape.id.parse(recipeId);
  const note = z.string().max(SHOPPING_NOTE_LIMIT).parse(value).replace(/\r\n?/g, '\n').trim();
  const next = { ...notes };
  if (note) next[recipeId] = note;
  else delete next[recipeId];
  return shoppingNotesSchema.parse(next);
}

/** Preserve notes for stable-ID replacements, discard notes for removed recipes. */
export function retainShoppingNotes(notes: ShoppingNotes, recipeIds: ReadonlySet<string>): ShoppingNotes {
  return Object.fromEntries(Object.entries(notes).filter(([id]) => recipeIds.has(id)));
}

export function shoppingNoteText(note: string | undefined): string[] {
  return note ? [`  Shopping note: ${note.replace(/\n/g, '\n    ')}`] : [];
}
