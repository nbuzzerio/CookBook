import { describe, expect, it } from 'vitest';
import { sampleRecipes } from '../data';
import type { Recipe } from './schema';
import { createDinnerPlan, dinnerDateLabel, dinnerTimeLabel, MAX_DINNER_RECIPES, parseLocalDinnerTime, suggestDinnerTime, toLocalDinnerInput } from './dinner';

const longRecipe: Recipe = { ...sampleRecipes[0], id: 'long-dinner', totalMinutes: 120, events: [
  { id: 'prep', startMinute: 0, durationMinutes: 20, title: 'Prep', instruction: 'Prepare vegetables.', track: 'Preparation' },
  { id: 'bake', startMinute: 60, durationMinutes: 60, title: 'Bake', instruction: 'Bake until done.', track: 'Oven' },
] };
const shortRecipe: Recipe = { ...sampleRecipes[1], id: 'short-dinner', totalMinutes: 60, events: [
  { id: 'prep', startMinute: 0, durationMinutes: 10, title: 'Prep', instruction: 'Prepare pasta.', track: 'Preparation' },
  { id: 'boil', startMinute: 10, durationMinutes: 20, title: 'Boil', instruction: 'Boil until tender.', track: 'Stovetop' },
] };
const recipes = [longRecipe, shortRecipe];
const selections = [{ recipeId: longRecipe.id, servings: 12 }, { recipeId: shortRecipe.id, servings: 6 }];
const target = Date.UTC(2030, 10, 6, 18, 0);

describe('one-dinner coordination', () => {
  it('offsets each recipe to the same finish time and preserves sorted parallel activities', () => {
    const plan = createDinnerPlan(recipes, selections, target);
    expect(plan.recipes.map((recipe) => recipe.finishAt)).toEqual([target, target]);
    expect(plan.recipes.map((recipe) => recipe.startAt)).toEqual([target - 120 * 60000, target - 60 * 60000]);
    expect(plan.events.map((entry) => `${entry.recipeId}/${entry.event.id}`)).toEqual(['long-dinner/prep', 'long-dinner/bake', 'short-dinner/prep', 'short-dinner/boil']);
    expect(plan.events[1].startAt).toBe(plan.events[2].startAt);
    expect(plan.events[1].overlaps).toContain(plan.events[2].key);
    expect(plan.events[1].overlaps).toContain(plan.events[3].key);
    expect(plan.events[2].overlaps).not.toContain(plan.events[3].key);
  });

  it('keeps cooking times unchanged when selected servings change', () => {
    const normal = createDinnerPlan(recipes, selections, target);
    const doubled = createDinnerPlan(recipes, selections.map((selection) => ({ ...selection, servings: selection.servings * 2 })), target);
    expect(doubled.recipes.map((recipe) => recipe.servings)).toEqual([24, 12]);
    expect(doubled.events.map((event) => [event.startAt, event.endAt])).toEqual(normal.events.map((event) => [event.startAt, event.endAt]));
    expect(doubled.earliestStart).toBe(normal.earliestStart);
    const fractional = createDinnerPlan(recipes, [{ recipeId: longRecipe.id, servings: 1.5 }], target);
    expect(fractional.recipes[0].servings).toBe(1.5);
    expect(fractional.recipes[0].startAt).toBe(normal.recipes[0].startAt);
  });

  it('returns an explicit limit state for oversized menus instead of a partial timeline', () => {
    const manyRecipes = Array.from({ length: MAX_DINNER_RECIPES + 1 }, (_, index) => ({ ...longRecipe, id: `recipe-${index}` }));
    const manySelections = manyRecipes.map((recipe) => ({ recipeId: recipe.id, servings: 4 }));
    const plan = createDinnerPlan(manyRecipes, manySelections, target);
    expect(plan).toMatchObject({ limitExceeded: true, selectedRecipeCount: 13, recipes: [], events: [], earliestStart: null });
    expect(createDinnerPlan(manyRecipes, manySelections.slice(0, MAX_DINNER_RECIPES), target).limitExceeded).toBe(false);
  });

  it('retains real dates when preparation crosses midnight and the year boundary', () => {
    const afterMidnight = Date.UTC(2031, 0, 1, 0, 30);
    const plan = createDinnerPlan(recipes, selections, afterMidnight);
    expect(plan.earliestStart).toBe(Date.UTC(2030, 11, 31, 22, 30));
    expect(dinnerDateLabel(plan.earliestStart!, 'en-US', 'UTC')).toContain('Dec 31, 2030');
    expect(dinnerDateLabel(plan.serveAt, 'en-US', 'UTC')).toContain('Jan 1, 2031');
    expect(dinnerTimeLabel(plan.earliestStart!, 'en-US', 'UTC')).toBe('10:30 PM');
    expect(dinnerTimeLabel(plan.serveAt, 'en-US', 'UTC')).toBe('12:30 AM');
  });

  it('ignores removed recipes and invalid selections, and deduplicates stable IDs', () => {
    const plan = createDinnerPlan(recipes, [
      ...selections,
      { recipeId: 'removed', servings: 4 },
      { recipeId: longRecipe.id, servings: 18 },
      { recipeId: shortRecipe.id, servings: NaN },
    ], target);
    expect(plan.recipes.map((recipe) => [recipe.recipe.id, recipe.servings])).toEqual([['long-dinner', 18]]);
    expect(createDinnerPlan(recipes, [], target)).toMatchObject({ recipes: [], events: [], earliestStart: null });
    expect(() => createDinnerPlan(recipes, selections, NaN)).toThrow('valid serving');
  });

  it('suggests a rounded finish that leaves enough time for the longest recipe', () => {
    const now = Date.UTC(2030, 10, 6, 16, 3);
    expect(suggestDinnerTime(recipes, selections, now)).toBe(Date.UTC(2030, 10, 6, 18, 15));
    expect(suggestDinnerTime(recipes, selections.map((selection) => ({ ...selection, servings: 1 })), now)).toBe(Date.UTC(2030, 10, 6, 18, 15));
  });

  it('parses local date input without accepting invalid dates or losing its selected time', () => {
    const parsed = parseLocalDinnerTime('2030-11-06T18:30');
    expect(parsed).not.toBeNull();
    expect(toLocalDinnerInput(parsed!)).toBe('2030-11-06T18:30');
    expect(parseLocalDinnerTime('2030-02-30T18:30')).toBeNull();
    expect(parseLocalDinnerTime('2030-11-06T25:00')).toBeNull();
    expect(parseLocalDinnerTime('not-a-date')).toBeNull();
  });
});
