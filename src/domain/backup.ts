import { z } from 'zod';
import { recipeSchema } from './schema';
import { validateCollectionSize } from './importExport';
import { shoppingNotesSchema } from './shoppingNotes';
import { aggregateShopping } from './shopping';
import { pauseTimer, timerSchema } from './timers';
import { elapsedTime, sessionSchema } from '../features/cooking/session';
import { reconcileShoppingChecklist, shoppingCompletionKey } from '../features/shopping/checklist';

export const MAX_BACKUP_BYTES = 4 * 1024 * 1024;
const id = recipeSchema.shape.id;
const timestamp = z.number().finite().nonnegative().max(253402300799999);
const servings = z.number().finite().min(1).max(100);
const record = <T extends z.ZodType>(value: T) => z.record(id, value)
  .refine(entries => Object.keys(entries).length <= 500, 'At most 500 recipe entries are supported');
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const ids = (limit: number) => z.array(id).max(limit).refine(unique, 'Duplicate IDs are not allowed');
const backupTimerSchema = timerSchema.safeExtend({ startedAt: timestamp.nullable() }).strict();
const backupSessionSchema = sessionSchema.safeExtend({
  accumulatedMs: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
  startedAt: timestamp.nullable(),
  completedIds: ids(200),
  selectedId: id,
  timers: z.record(id, backupTimerSchema).refine(timers => Object.keys(timers).length <= 200, 'At most 200 timers are supported per recipe'),
}).strict();
const checklistKeys = z.array(z.string().min(1).max(MAX_BACKUP_BYTES)).max(150000)
  .refine(unique, 'Duplicate shopping completion keys are not allowed');

export const backupStateSchema = z.object({
  recipes: z.array(recipeSchema).max(500).refine(recipes => unique(recipes.map(recipe => recipe.id)), 'Duplicate recipe IDs are not allowed'),
  favorites: ids(500),
  theme: z.enum(['light', 'dark', 'system']),
  shoppingPlan: z.array(z.object({ recipeId: id, servings }).strict()).max(500)
    .refine(plan => unique(plan.map(selection => selection.recipeId)), 'Duplicate shopping recipe IDs are not allowed'),
  servings: record(servings),
  shoppingNotes: shoppingNotesSchema,
  ingredientChecks: record(ids(300)),
  sessions: record(backupSessionSchema),
  shoppingChecklist: z.object({ checked: checklistKeys, hidden: checklistKeys }).strict(),
  dinnerTiming: z.object({ serveAt: timestamp.int().positive() }).strict().nullable(),
}).strict().superRefine((state, context) => {
  const recipes = new Map(state.recipes.map(recipe => [recipe.id, recipe]));
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });
  state.favorites.forEach((recipeId, index) => {
    if (!recipes.has(recipeId)) issue(['favorites', index], 'Recipe reference does not exist in this backup');
  });
  state.shoppingPlan.forEach((selection, index) => {
    if (!recipes.has(selection.recipeId)) issue(['shoppingPlan', index, 'recipeId'], 'Recipe reference does not exist in this backup');
  });
  for (const field of ['servings', 'shoppingNotes', 'ingredientChecks', 'sessions'] as const) {
    for (const recipeId of Object.keys(state[field])) {
      if (!recipes.has(recipeId)) issue([field, recipeId], 'Recipe reference does not exist in this backup');
    }
  }
  for (const [recipeId, checks] of Object.entries(state.ingredientChecks)) {
    const recipe = recipes.get(recipeId);
    if (!recipe) continue;
    const ingredientIds = new Set(recipe.ingredients.map(ingredient => ingredient.id));
    checks.forEach((ingredientId, index) => {
      if (!ingredientIds.has(ingredientId)) issue(['ingredientChecks', recipeId, index], 'Ingredient reference does not exist in this recipe');
    });
  }
  for (const [recipeId, session] of Object.entries(state.sessions)) {
    const recipe = recipes.get(recipeId);
    if (!recipe) continue;
    const events = new Map(recipe.events.map(event => [event.id, event]));
    if (!events.has(session.selectedId)) issue(['sessions', recipeId, 'selectedId'], 'Selected step does not exist in this recipe');
    session.completedIds.forEach((eventId, index) => {
      if (!events.has(eventId)) issue(['sessions', recipeId, 'completedIds', index], 'Completed step does not exist in this recipe');
    });
    for (const eventId of Object.keys(session.timers)) {
      if (!events.get(eventId)?.timerMinutes) issue(['sessions', recipeId, 'timers', eventId], 'Timer must belong to a timed step in this recipe');
    }
  }
  const completionKeys = new Set(aggregateShopping(state.recipes, state.shoppingPlan).map(shoppingCompletionKey));
  const checked = new Set(state.shoppingChecklist.checked);
  for (const field of ['checked', 'hidden'] as const) {
    state.shoppingChecklist[field].forEach((key, index) => {
      if (!completionKeys.has(key)) issue(['shoppingChecklist', field, index], 'Shopping completion does not match the current ingredients and servings');
      else if (field === 'hidden' && !checked.has(key)) issue(['shoppingChecklist', field, index], 'A hidden shopping item must also be checked');
    });
  }
  try { validateCollectionSize(state.recipes); }
  catch { issue(['recipes'], 'The recipe collection exceeds the 2 MB recipe collection limit'); }
});

export const backupSchema = z.object({
  format: z.literal('countertop-backup'),
  version: z.literal(1),
  createdAt: z.string().datetime({ offset: true }).refine(value => Date.parse(value) >= 0, 'Use a valid backup timestamp from 1970 onward'),
  state: backupStateSchema,
}).strict();

export type BackupState = z.infer<typeof backupStateSchema>;
export type CookbookBackup = z.infer<typeof backupSchema>;

function validateBackup(value: unknown): CookbookBackup {
  const result = backupSchema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues.slice(0, 8)
    .map(issue => `${issue.path.join('.') || 'Backup'}: ${issue.message}`).join('\n'));
  return result.data;
}

function checkSize(text: string): void {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES) throw new Error('This backup is too large. Full cookbook backups must be 4 MB or smaller; image files stay separate.');
}

export function parseBackup(text: string): CookbookBackup {
  checkSize(text);
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { throw new Error('This is not valid JSON. Choose a complete Countertop backup file.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('format' in value) || value.format !== 'countertop-backup') {
    throw new Error('Expected a full Countertop backup. Recipe-only JSON files belong in Import recipes.');
  }
  if (!('version' in value) || value.version !== 1) throw new Error('Unsupported or missing backup version. Countertop supports backup version: 1.');
  return validateBackup(value);
}

export function serializeBackup(backup: CookbookBackup): string {
  const text = JSON.stringify(validateBackup(backup), null, 2);
  checkSize(text);
  return text;
}

/** Clean only stale local references when taking a snapshot; imported files must validate as supplied. */
export function normalizeBackupState(state: BackupState): BackupState {
  const recipes = new Map(state.recipes.map(recipe => [recipe.id, recipe]));
  const retainRecipes = <T>(entries: Record<string, T>) => Object.fromEntries(Object.entries(entries).filter(([recipeId]) => recipes.has(recipeId)));
  const shoppingPlan = [...new Map(state.shoppingPlan.filter(selection => recipes.has(selection.recipeId)).map(selection => [selection.recipeId, selection])).values()];
  const ingredientChecks = Object.fromEntries(Object.entries(retainRecipes(state.ingredientChecks)).map(([recipeId, checks]) => {
    const allowed = new Set(recipes.get(recipeId)!.ingredients.map(ingredient => ingredient.id));
    return [recipeId, [...new Set(checks)].filter(ingredientId => allowed.has(ingredientId))];
  }));
  const sessions = Object.fromEntries(Object.entries(retainRecipes(state.sessions)).map(([recipeId, session]) => {
    const recipe = recipes.get(recipeId)!;
    const events = new Map(recipe.events.map(event => [event.id, event]));
    return [recipeId, {
      ...session,
      completedIds: [...new Set(session.completedIds)].filter(eventId => events.has(eventId)),
      selectedId: events.has(session.selectedId) ? session.selectedId : recipe.events[0].id,
      timers: Object.fromEntries(Object.entries(session.timers).filter(([eventId]) => events.get(eventId)?.timerMinutes)),
    }];
  }));
  const completionKeys = new Set(aggregateShopping(state.recipes, shoppingPlan).map(shoppingCompletionKey));
  const shoppingChecklist = reconcileShoppingChecklist({ checked: [...new Set(state.shoppingChecklist.checked)], hidden: [...new Set(state.shoppingChecklist.hidden)] }, completionKeys);
  return {
    ...state,
    favorites: [...new Set(state.favorites)].filter(recipeId => recipes.has(recipeId)),
    shoppingPlan,
    servings: retainRecipes(state.servings),
    shoppingNotes: retainRecipes(state.shoppingNotes),
    ingredientChecks,
    sessions,
    shoppingChecklist,
  };
}

/** Restoring a saved dinner must never silently start clocks or count the time since export. */
export function pauseBackupSessions(backup: CookbookBackup): CookbookBackup {
  const now = Date.parse(backup.createdAt);
  const sessions = Object.fromEntries(Object.entries(backup.state.sessions).map(([recipeId, session]) => [recipeId, {
    ...session,
    ...(session.status === 'running' ? { status: 'paused' as const, accumulatedMs: elapsedTime(session, now), startedAt: null } : {}),
    timers: Object.fromEntries(Object.entries(session.timers).map(([eventId, timer]) => [eventId, timer.status === 'running' ? pauseTimer(timer, now) : timer])),
  }]));
  return { ...backup, state: { ...backup.state, sessions } };
}
