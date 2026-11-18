import { recipeCollectionSchema, recipeSchema, type Recipe } from './schema';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export function parseRecipeImport(text: string): Recipe[] {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error('This file is too large. Keep recipe imports under 2 MB and use image paths instead of embedded images.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('This is not valid JSON. Check for missing commas, unmatched quotes, or an incomplete file.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a recipe object or a collection with schemaVersion and recipes.');
  if (!('schemaVersion' in value) || value.schemaVersion !== 1) throw new Error('Unsupported or missing schemaVersion. Countertop v0.1 supports schemaVersion: 1.');
  const isCollection = 'recipes' in value && !('id' in value);
  const parsed = isCollection ? recipeCollectionSchema.safeParse(value) : recipeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.') || 'Recipe'}: ${issue.message}`).join('\n'));
  }
  return isCollection && 'recipes' in value ? value.recipes as Recipe[] : [value as Recipe];
}

// A replacement authored by an older editor may omit metadata it could not display.
function retainMetadata<T extends Record<string, unknown>>(old: T, next: T, fields: object): T {
  const extras = Object.entries(old).filter(([key]) => !Object.hasOwn(fields, key));
  return { ...Object.fromEntries(extras), ...next };
}
function replaceRecipe(old: Recipe, next: Recipe): Recipe {
  const replaced = retainMetadata(old, next, recipeSchema.shape);
  for (const field of ['components', 'ingredients', 'events'] as const) {
    const prior = new Map(old[field].map(item => [item.id, item]));
    const known = recipeSchema.shape[field].element.shape;
    Object.assign(replaced, { [field]: next[field].map(item => {
      const previous = prior.get(item.id);
      return previous ? retainMetadata<Record<string, unknown>>(previous, item, known) : item;
    }) });
  }
  return replaced;
}

export function mergeRecipes(existing: Recipe[], incoming: Recipe[], behavior: 'replace' | 'skip') {
  const byId = new Map(existing.map((recipe) => [recipe.id, recipe]));
  let added = 0;
  let replaced = 0;
  let skipped = 0;
  for (const recipe of incoming) {
    if (byId.has(recipe.id)) {
      if (behavior === 'skip') { skipped++; continue; }
      byId.set(recipe.id, replaceRecipe(byId.get(recipe.id)!, recipe));
      replaced++;
    } else { added++; byId.set(recipe.id, recipe); }
  }
  return {recipes: [...byId.values()], added, replaced, skipped};
}

export function exportRecipes(recipes: Recipe[]): string {
  recipeCollectionSchema.parse({schemaVersion: 1, recipes});
  return JSON.stringify({schemaVersion: 1, recipes}, null, 2);
}

/** Apply before saving merged imports so every accepted cookbook can be reimported. */
export function validateCollectionSize(recipes: Recipe[]): void {
  if (new TextEncoder().encode(exportRecipes(recipes)).length > MAX_IMPORT_BYTES) {
    throw new Error('The combined cookbook would exceed the 2 MB collection limit. Export a backup, then remove some recipes before importing more. This limit keeps every cookbook backup importable.');
  }
}
