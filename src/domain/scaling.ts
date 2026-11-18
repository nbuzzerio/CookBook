import type { Ingredient } from './schema';

/** Always supply the recipe's original ingredient; never a previously scaled copy. */
export function scaleIngredient(ingredient: Ingredient, baseServings: number, desiredServings: number): Ingredient {
  if (!Number.isFinite(baseServings) || baseServings <= 0 || !Number.isFinite(desiredServings) || desiredServings <= 0) throw new Error('Serving counts must be positive numbers');
  return { ...ingredient, quantity: ingredient.scalable && ingredient.quantity !== undefined ? ingredient.quantity * desiredServings / baseServings : ingredient.quantity };
}

const fractions: [number, string][] = [[1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞']];

export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value);
  if (value === 0 || (rounded !== 0 && Math.abs(value - rounded) < 0.0001)) return String(rounded);
  const whole = Math.floor(value);
  const fraction = fractions.find(([amount]) => Math.abs(value - whole - amount) < 0.008);
  if (fraction) return `${whole || ''}${fraction[1]}`;
  // Small quantities retain useful precision while normal values stay readable.
  return Number(value > 0 && value < 0.1 ? value.toPrecision(2) : value.toFixed(2)).toString();
}

export function amountText(quantity?: number, unit?: string, quantityText?: string): string {
  if (quantity === undefined) return quantityText ?? '';
  const countableUnits = ['cup', 'tablespoon', 'teaspoon', 'clove', 'can', 'bunch', 'slice', 'sprig', 'package'];
  let displayUnit = unit ?? '';
  const singular = displayUnit.replace(/s$/, '');
  if (countableUnits.includes(singular)) displayUnit = quantity <= 1 ? singular : `${singular}s`;
  return [formatQuantity(quantity), displayUnit, quantityText].filter(Boolean).join(' ');
}

export function ingredientAmount(ingredient: Ingredient, baseServings: number, desiredServings: number): string {
  const scaled = scaleIngredient(ingredient, baseServings, desiredServings);
  return amountText(scaled.quantity, scaled.unit, scaled.quantityText);
}
