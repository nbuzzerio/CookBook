import type { Ingredient, Recipe } from './schema';
import { amountText, scaleIngredient } from './scaling';

export interface ShoppingSelection { recipeId: string; servings: number }
export interface ShoppingItem {
  key: string;
  name: string;
  quantity?: number;
  unit?: string;
  quantityText?: string;
  preparations: string[];
  optional: boolean;
  groceryCategory: Ingredient['groceryCategory'];
  sources: string[];
}

const unitAliases: Record<string, string> = { cups: 'cup', tablespoons: 'tbsp', tablespoon: 'tbsp', teaspoons: 'tsp', teaspoon: 'tsp', pounds: 'lb', pound: 'lb', lbs: 'lb', ounces: 'oz', ounce: 'oz', cloves: 'clove', cans: 'can', slices: 'slice', sprigs: 'sprig' };
const normalizedUnit = (unit = '') => { const normalized = unit.toLowerCase().trim(); return unitAliases[normalized] ?? normalized; };

export function aggregateShopping(recipes: Recipe[], selections: ShoppingSelection[]): ShoppingItem[] {
  const result = new Map<string, ShoppingItem>();
  // Repeated selections of one recipe are a replacement, not an accidental double order.
  const uniqueSelections = new Map(selections.map((selection) => [selection.recipeId, selection]));
  uniqueSelections.forEach((selection) => {
    const recipe = recipes.find((candidate) => candidate.id === selection.recipeId);
    if (!recipe || !Number.isFinite(selection.servings) || selection.servings <= 0) return;
    recipe.ingredients.forEach((original) => {
      const ingredient = scaleIngredient(original, recipe.servings, selection.servings);
      const unit = normalizedUnit(ingredient.unit);
      const key = JSON.stringify([ingredient.shoppingKey.toLowerCase(), unit, ingredient.quantity === undefined ? 'text' : 'number', ingredient.quantityText?.toLowerCase().trim() ?? '']);
      const existing = result.get(key);
      if (existing) {
        if (ingredient.quantity !== undefined) existing.quantity = (existing.quantity ?? 0) + ingredient.quantity;
        if (ingredient.preparation && !existing.preparations.includes(ingredient.preparation)) existing.preparations.push(ingredient.preparation);
        if (!existing.sources.includes(recipe.name)) existing.sources.push(recipe.name);
        existing.optional = existing.optional && ingredient.optional;
      } else {
        result.set(key, {key, name: ingredient.name, quantity: ingredient.quantity, unit, quantityText: ingredient.quantityText, preparations: ingredient.preparation ? [ingredient.preparation] : [], optional: ingredient.optional, groceryCategory: ingredient.groceryCategory, sources: [recipe.name]});
      }
    });
  });
  const categories = ['Produce', 'Meat', 'Dairy', 'Pantry', 'Bakery', 'Other'];
  return [...result.values()].sort((a, b) => categories.indexOf(a.groceryCategory) - categories.indexOf(b.groceryCategory) || a.name.localeCompare(b.name));
}

export function shoppingItemAmount(item: ShoppingItem): string { return amountText(item.quantity, item.unit, item.quantityText); }
