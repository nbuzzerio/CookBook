import type { CookingEvent, Recipe } from './schema';
import type { ShoppingSelection } from './shopping';

const MINUTE = 60_000;
export const MAX_DINNER_RECIPES = 12;

export interface DinnerRecipe {
  recipe: Recipe;
  servings: number;
  startAt: number;
  finishAt: number;
}

export interface DinnerEvent {
  key: string;
  recipeId: string;
  recipeName: string;
  recipeIndex: number;
  event: CookingEvent;
  startAt: number;
  endAt: number;
  overlaps: string[];
}

export interface DinnerPlan {
  serveAt: number;
  recipes: DinnerRecipe[];
  events: DinnerEvent[];
  earliestStart: number | null;
  selectedRecipeCount: number;
  limitExceeded: boolean;
}

function selectedRecipes(recipes: Recipe[], selections: ShoppingSelection[]) {
  const unique = new Map(selections.map((selection) => [selection.recipeId, selection]));
  return [...unique.values()].flatMap((selection) => {
    const recipe = recipes.find((candidate) => candidate.id === selection.recipeId);
    return recipe && Number.isFinite(selection.servings) && selection.servings >= 1 && selection.servings <= 100
      ? [{ recipe, servings: selection.servings }]
      : [];
  });
}

/** Coordinate estimates; portions never change authored cooking durations. */
export function createDinnerPlan(recipes: Recipe[], selections: ShoppingSelection[], serveAt: number): DinnerPlan {
  if (!Number.isFinite(serveAt) || !Number.isFinite(new Date(serveAt).getTime())) throw new Error('Choose a valid serving date and time.');
  const selected = selectedRecipes(recipes, selections);
  if (selected.length > MAX_DINNER_RECIPES) return { serveAt, recipes: [], events: [], earliestStart: null, selectedRecipeCount: selected.length, limitExceeded: true };
  const plannedRecipes = selected.map(({ recipe, servings }) => ({ recipe, servings, startAt: serveAt - recipe.totalMinutes * MINUTE, finishAt: serveAt }));
  const events = plannedRecipes.flatMap(({ recipe, startAt }, recipeIndex) => recipe.events.map((event, eventIndex) => ({
    key: JSON.stringify([recipe.id, event.id]),
    recipeId: recipe.id,
    recipeName: recipe.name,
    recipeIndex,
    event,
    eventIndex,
    startAt: startAt + event.startMinute * MINUTE,
    endAt: startAt + (event.startMinute + (event.durationMinutes ?? 0)) * MINUTE,
    overlaps: [] as string[],
  }))).sort((a, b) => a.startAt - b.startAt || a.recipeIndex - b.recipeIndex || a.eventIndex - b.eventIndex);

  for (const event of events) {
    event.overlaps = events.filter((other) => other.key !== event.key && (
      other.startAt === event.startAt ||
      (other.startAt < event.endAt && other.endAt > event.startAt) ||
      (event.startAt === event.endAt && other.startAt < event.startAt && other.endAt > event.startAt)
    )).map((other) => other.key);
  }

  return {
    serveAt,
    recipes: plannedRecipes,
    events,
    earliestStart: plannedRecipes.length ? Math.min(...plannedRecipes.map((recipe) => recipe.startAt)) : null,
    selectedRecipeCount: plannedRecipes.length,
    limitExceeded: false,
  };
}

export function suggestDinnerTime(recipes: Recipe[], selections: ShoppingSelection[], now = Date.now()): number {
  const selected = selectedRecipes(recipes, selections);
  const longest = selected.length ? Math.max(...selected.map(({ recipe }) => recipe.totalMinutes)) : 60;
  const quarterHour = 15 * MINUTE;
  return Math.ceil((now + longest * MINUTE) / quarterHour) * quarterHour;
}

export function toLocalDinnerInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Reject impossible dates and nonexistent local times instead of silently moving them. */
export function parseLocalDinnerTime(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  if (year < 1970 || year > 9999) return null;
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(hour, minute, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hour || date.getMinutes() !== minute) return null;
  return date.getTime();
}

export function dinnerDateLabel(timestamp: number, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone }).format(timestamp);
}

export function dinnerTimeLabel(timestamp: number, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', second: new Date(timestamp).getSeconds() ? '2-digit' : undefined, timeZone }).format(timestamp);
}
