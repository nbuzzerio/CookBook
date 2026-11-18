import { describe, expect, it } from 'vitest';
import { sampleRecipes } from '../data';
import { aggregateShopping } from './shopping';
import { parseRecipeImport, exportRecipes } from './importExport';
import { retainShoppingNotes, shoppingNotesSchema, shoppingNoteText, updateShoppingNote } from './shoppingNotes';

describe('personal shopping reminders', () => {
  it('normalizes plain text and preserves separate recipe notes without mutating the original map', () => {
    const notes = { [sampleRecipes[0].id]: 'Choose certified GF oats.' };
    const updated = updateShoppingNote(notes, sampleRecipes[1].id, '  Check the pasta shape.\r\nBring a large bag.  ');
    expect(updated[sampleRecipes[1].id]).toBe('Check the pasta shape.\nBring a large bag.');
    expect(updated[sampleRecipes[0].id]).toBe(notes[sampleRecipes[0].id]);
    expect(Object.keys(notes)).toHaveLength(1);
    expect(updateShoppingNote(updated, sampleRecipes[0].id, '   ')).toEqual({[sampleRecipes[1].id]:updated[sampleRecipes[1].id]});
  });
  it('rejects invalid or oversized persisted notes and unsafe IDs', () => {
    expect(shoppingNotesSchema.safeParse({[sampleRecipes[0].id]:123}).success).toBe(false);
    expect(shoppingNotesSchema.safeParse({[sampleRecipes[0].id]:'a'.repeat(501)}).success).toBe(false);
    expect(()=>updateShoppingNote({},'constructor','test')).toThrow();
    expect(()=>updateShoppingNote({},sampleRecipes[0].id,'a'.repeat(501))).toThrow();
    expect(updateShoppingNote({},sampleRecipes[0].id,'a'.repeat(500))[sampleRecipes[0].id]).toHaveLength(500);
  });
  it('keeps stable-ID replacements and removes deleted recipes from annotation storage', () => {
    const notes = {[sampleRecipes[0].id]:'My reminder.',[sampleRecipes[1].id]:'Another reminder.'};
    expect(retainShoppingNotes(notes,new Set([sampleRecipes[0].id]))).toEqual({[sampleRecipes[0].id]:'My reminder.'});
  });
  it('does not treat numbers or markup in a note as ingredients or recipe data', () => {
    const selections = [{recipeId:sampleRecipes[0].id,servings:24}];
    const before = aggregateShopping(sampleRecipes,selections);
    const notes = updateShoppingNote({},sampleRecipes[0].id,'3 cups of sugar <b>buy a different brand</b>');
    expect(shoppingNoteText(notes[sampleRecipes[0].id])).toEqual(['  Shopping note: 3 cups of sugar <b>buy a different brand</b>']);
    expect(aggregateShopping(sampleRecipes,selections)).toEqual(before);
    expect(parseRecipeImport(exportRecipes(sampleRecipes))).toEqual(sampleRecipes);
  });
});
