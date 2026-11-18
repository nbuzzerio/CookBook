import { describe, expect, it } from 'vitest';
import { sampleRecipes } from '../data';
import exampleRecipe from '../../public/examples/recipe.json';
import { recipeSchema } from './schema';
import { ingredientAmount, scaleIngredient, formatQuantity } from './scaling';
import { aggregateShopping } from './shopping';
import { sortedEvents, parallelEvents, formatMinute } from './timeline';
import { createTimer, getRemainingMs, pauseTimer, resetTimer, startTimer, synchronizeTimer, timerSchema } from './timers';
import { exportRecipes, MAX_IMPORT_BYTES, mergeRecipes, parseRecipeImport, validateCollectionSize } from './importExport';

const recipe = sampleRecipes[0]!;
const beef = recipe.ingredients.find((ingredient) => ingredient.id === 'beef-meat')!;

describe('recipe schema and portability', () => {
  it('validates all complete bundled recipes and a single-recipe JSON import', () => {
    expect(sampleRecipes).toHaveLength(3);
    for (const sample of sampleRecipes) expect(recipeSchema.safeParse(sample).success).toBe(true);
    expect(parseRecipeImport(JSON.stringify(recipe))).toEqual([recipe]);
    expect(parseRecipeImport(JSON.stringify(exampleRecipe))).toEqual([sampleRecipes[1]]);
  });
  it('preserves readable Unicode in sample temperatures and instructions', () => {
    expect(JSON.stringify(sampleRecipes)).not.toContain('?');
    expect(JSON.stringify(sampleRecipes)).not.toContain('\uFFFD');
    expect(recipe.events.find((event) => event.id === 'bake-beef')!.temperature).toBe('350°F / 175°C');
    expect(recipe.events.find((event) => event.id === 'mince-mushrooms')!.instruction).toContain('loaf’s mushrooms');
  });
  it('reports malformed JSON and meaningful invalid-field paths', () => {
    expect(() => parseRecipeImport('{broken')).toThrow('not valid JSON');
    expect(() => parseRecipeImport(JSON.stringify({...recipe, name: '', servings: -2}))).toThrow(/name:.*servings:/s);
    expect(() => parseRecipeImport(JSON.stringify({...recipe, ingredients: [{...beef, quantity: -1}]}))).toThrow('ingredients.0.quantity');
  });
  it('rejects unsupported schema versions, oversized files, and embedded image payloads', () => {
    expect(() => parseRecipeImport(JSON.stringify({...recipe, schemaVersion: 2}))).toThrow('schemaVersion');
    expect(() => parseRecipeImport(' '.repeat(MAX_IMPORT_BYTES + 1))).toThrow('too large');
    expect(recipeSchema.safeParse({...recipe, coverImage: 'data:image/png;base64,AAAA'}).success).toBe(false);
    expect(recipeSchema.safeParse({...recipe, coverImage: 'javascript:alert(1)'}).success).toBe(false);
    expect(recipeSchema.safeParse({...recipe, coverImage: '../secret.png'}).success).toBe(false);
  });
  it('rejects duplicate ingredient IDs and nonexistent component references', () => {
    expect(recipeSchema.safeParse({...recipe, ingredients: [beef, beef]}).success).toBe(false);
    expect(recipeSchema.safeParse({...recipe, ingredients: [{...beef, componentId: 'missing'}]}).success).toBe(false);
    expect(recipeSchema.safeParse({...recipe, events: [{...recipe.events[0], componentId: 'missing'}]}).success).toBe(false);
  });
  it('rejects inherited object property names as IDs before they reach persisted lookups', () => {
    for (const id of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'prototype']) {
      expect(() => parseRecipeImport(JSON.stringify({...recipe, id}))).toThrow('ID is reserved');
    }
    expect(() => parseRecipeImport(JSON.stringify({...recipe, events: [{...recipe.events[0], id: 'toString'}]}))).toThrow('events.0.id: This ID is reserved');
    expect(recipeSchema.safeParse({...recipe, id: 'mushroom-dinner'}).success).toBe(true);
  });
  it('handles duplicate recipe IDs deterministically using replace or skip', () => {
    const first = {...recipe, name: 'First'};
    const last = {...recipe, name: 'Last'};
    expect(mergeRecipes([recipe], [first, last], 'replace')).toEqual({recipes: [last], added: 0, replaced: 2, skipped: 0});
    expect(mergeRecipes([recipe], [first, last], 'skip')).toEqual({recipes: [recipe], added: 0, replaced: 0, skipped: 2});
    expect(mergeRecipes([], [first, last], 'skip').recipes).toEqual([first]);
    expect(mergeRecipes([], [first, last], 'replace').recipes).toEqual([last]);
  });
  it('round-trips the full exported collection without losing content', () => {
    expect(() => validateCollectionSize(sampleRecipes)).not.toThrow();
    expect(parseRecipeImport(exportRecipes(sampleRecipes))).toEqual(sampleRecipes);
    expect(parseRecipeImport(exportRecipes([]))).toEqual([]);
  });
  it('rejects oversized merged collections before persistence and measures UTF-8 export bytes', () => {
    const largeRecipes = Array.from({length: 8}, (_, index) => ({...recipe, id: `large-${index}`, notes: Array.from({length: 50}, () => 'é'.repeat(3000))}));
    expect(() => validateCollectionSize(largeRecipes)).toThrow('combined cookbook');
    expect(() => validateCollectionSize(largeRecipes.slice(0, 2))).not.toThrow();
    expect(parseRecipeImport(exportRecipes(largeRecipes.slice(0, 2)))).toEqual(largeRecipes.slice(0, 2));
  });
  it('does not mutate existing recipes when an import fails', () => {
    const before = JSON.stringify(sampleRecipes);
    expect(() => parseRecipeImport(JSON.stringify({schemaVersion: 1, recipes: [recipe, {schemaVersion: 1, id: 'bad'}]}))).toThrow();
    expect(JSON.stringify(sampleRecipes)).toBe(before);
  });
});

describe('ingredient quantities', () => {
  it('scales from immutable originals rather than compounded values', () => {
    const half = scaleIngredient(beef, 12, 6);
    const double = scaleIngredient(beef, 12, 24);
    expect(half.quantity).toBe(1.25);
    expect(double.quantity).toBe(5);
    expect(beef.quantity).toBe(2.5);
    expect(scaleIngredient(beef, 12, 12).quantity).toBe(2.5);
    expect(half).not.toBe(beef);
  });
  it('preserves non-scalable quantities and text', () => {
    const toTaste = recipe.ingredients.find((ingredient) => ingredient.quantityText === 'to taste')!;
    expect(scaleIngredient(toTaste, 12, 36)).toEqual(toTaste);
    expect(ingredientAmount(toTaste, 12, 36)).toBe('to taste');
    expect(scaleIngredient({...beef, scalable: false}, 12, 36).quantity).toBe(2.5);
  });
  it('formats sensible fractions and bounded decimal precision', () => {
    expect(formatQuantity(0.5)).toBe('½');
    expect(formatQuantity(1.25)).toBe('1¼');
    expect(formatQuantity(1 / 3)).toBe('⅓');
    expect(formatQuantity(2.5000000001)).toBe('2½');
    expect(formatQuantity(1.237)).toBe('1.24');
    expect(formatQuantity(0.000125)).toBe('0.00013');
    expect(formatQuantity(0.00001)).toBe('0.00001');
    expect(ingredientAmount({...beef, quantity: 1, unit: 'cup'}, 4, 5)).toBe('1¼ cups');
    expect(ingredientAmount({...beef, quantity: 1, unit: 'cups'}, 4, 2)).toBe('½ cup');
    expect(() => scaleIngredient(beef, 0, 6)).toThrow('positive');
  });
});

describe('shopping aggregation', () => {
  it('merges matching ingredients across components and recipe selections', () => {
    const items = aggregateShopping(sampleRecipes, [{recipeId: recipe.id, servings: 12}, {recipeId: sampleRecipes[1]!.id, servings: 6}]);
    const garlic = items.filter((item) => item.key.includes('garlic'));
    expect(garlic).toHaveLength(1);
    expect(garlic[0]!.quantity).toBe(8);
    expect(garlic[0]!.sources).toHaveLength(2);
    expect(garlic[0]!.preparations).toContain('Minced');
  });
  it('keeps different units, text quantities, and identities separate', () => {
    const items = aggregateShopping(sampleRecipes, [{recipeId: recipe.id, servings: 12}, {recipeId: sampleRecipes[1]!.id, servings: 6}]);
    expect(items.filter((item) => item.name === 'Mozzarella')).toHaveLength(2);
    expect(items.filter((item) => item.name === 'Black pepper')).toHaveLength(2);
    expect(items.filter((item) => item.name.includes('mushrooms'))).toHaveLength(3);
  });
  it('recalculates shopping amounts directly from recipe originals', () => {
    const half = aggregateShopping([recipe], [{recipeId: recipe.id, servings: 6}]);
    const full = aggregateShopping([recipe], [{recipeId: recipe.id, servings: 12}]);
    expect(half.find((item) => item.name === 'Ground beef')!.quantity).toBe(1.25);
    expect(full.find((item) => item.name === 'Ground beef')!.quantity).toBe(2.5);
    expect(aggregateShopping([recipe], [{recipeId: 'missing', servings: 2}])).toEqual([]);
  });
});

describe('chronological overlap', () => {
  it('preserves fractional-minute timestamps and carries rounded seconds correctly', () => {
    expect(formatMinute(0.5)).toBe('0:00:30');
    expect(formatMinute(65)).toBe('1:05');
    expect(formatMinute(1.999)).toBe('0:02:00');
    expect(formatMinute(59.999)).toBe('1:00:00');
  });
  it('sorts events stably and retains simultaneous activities', () => {
    const events = sampleRecipes[1]!.events;
    const sorted = sortedEvents([...events].reverse());
    expect(sorted.map((event) => event.startMinute)).toEqual([0, 0, 10, 10, 20, 25, 45, 55, 65]);
    expect(sorted).toHaveLength(events.length);
    expect(parallelEvents(events, events[0]!).some((event) => event.id === 'brown-mushrooms')).toBe(true);
    expect(events[0]!.id).toBe('heat-oven-water');
  });
  it('recognizes tasks starting during an existing activity', () => {
    const baking = recipe.events.find((event) => event.id === 'bake-beef')!;
    expect(parallelEvents(recipe.events, baking).some((event) => event.id === 'bake-lentil')).toBe(true);
  });
});

describe('persistent timestamp timers', () => {
  it('derives elapsed time from persisted timestamps after a refresh or inactive tab', () => {
    const running = startTimer(createTimer(60000), 1000);
    const restored = timerSchema.parse(JSON.parse(JSON.stringify(running)));
    expect(getRemainingMs(restored, 31000)).toBe(30000);
    expect(getRemainingMs(restored, 100000)).toBe(0);
    expect(synchronizeTimer(restored, 100000).status).toBe('finished');
  });
  it('pauses, resumes, resets, and keeps concurrent timers independent', () => {
    const timer = startTimer(createTimer(60000), 1000);
    const other = startTimer(createTimer(120000), 1000);
    const paused = pauseTimer(timer, 11000);
    expect(getRemainingMs(paused, 99000)).toBe(50000);
    const resumed = startTimer(paused, 100000);
    expect(getRemainingMs(resumed, 110000)).toBe(40000);
    expect(getRemainingMs(other, 110000)).toBe(11000);
    expect(resetTimer(resumed)).toEqual(createTimer(60000));
  });
  it('never gains time on a backward clock change or starts without explicit action', () => {
    const idle = createTimer(60000);
    expect(getRemainingMs(idle, 1000000)).toBe(60000);
    expect(getRemainingMs(startTimer(idle, 1000), 500)).toBe(60000);
    expect(timerSchema.safeParse({...idle, status: 'running'}).success).toBe(false);
  });
});
