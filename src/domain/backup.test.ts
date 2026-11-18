import { describe, expect, it } from 'vitest';
import { sampleRecipes } from '../data';
import { freshSession } from '../features/cooking/session';
import { shoppingCompletionKey } from '../features/shopping/checklist';
import { aggregateShopping } from './shopping';
import { createTimer, getRemainingMs, startTimer } from './timers';
import { backupSchema, MAX_BACKUP_BYTES, normalizeBackupState, parseBackup, pauseBackupSessions, serializeBackup, type CookbookBackup } from './backup';

const recipe = sampleRecipes[0];
const timed = recipe.events.find(event => event.timerMinutes)!;
const secondTimed = recipe.events.find(event => event.timerMinutes && event.id !== timed.id)!;
const now = Date.parse('2026-11-06T12:00:00.000Z');

function fixture(): CookbookBackup {
  const shoppingPlan = [{ recipeId: recipe.id, servings: 6 }];
  const key = shoppingCompletionKey(aggregateShopping(sampleRecipes, shoppingPlan)[0]);
  return {
    format: 'countertop-backup', version: 1, createdAt: new Date(now).toISOString(),
    state: {
      recipes: sampleRecipes, favorites: [recipe.id], theme: 'dark', shoppingPlan,
      servings: { [recipe.id]: 6 }, shoppingNotes: { [recipe.id]: 'Choose the GF brand.\nCheck the package.' },
      ingredientChecks: { [recipe.id]: [recipe.ingredients[0].id] },
      sessions: { [recipe.id]: {
        ...freshSession(timed.id), status: 'running', accumulatedMs: 10000, startedAt: now - 15000,
        completedIds: [recipe.events[0].id],
        timers: { [timed.id]: startTimer(createTimer(60000), now - 20000) },
      } },
      shoppingChecklist: { checked: [key], hidden: [key] }, dinnerTiming: { serveAt: now + 7200000 },
    },
  };
}

describe('full cookbook backup format', () => {
  it('round-trips recipes, personal notes, checklists, preferences, shopping plan, and independent session state', () => {
    const backup = fixture();
    expect(backupSchema.safeParse(backup).success).toBe(true);
    expect(parseBackup(serializeBackup(backup))).toEqual(backup);
    expect(backup.state.recipes[0]).toEqual(recipe);
    expect(backup.state.sessions[recipe.id].status).toBe('running');
  });

  it('supports an intentionally empty cookbook with no dinner plan', () => {
    const backup = fixture();
    backup.state = { recipes: [], favorites: [], theme: 'system', shoppingPlan: [], servings: {}, shoppingNotes: {}, ingredientChecks: {}, sessions: {}, shoppingChecklist: { checked: [], hidden: [] }, dinnerTiming: null };
    expect(parseBackup(serializeBackup(backup))).toEqual(backup);
  });

  it('rejects malformed JSON, recipe-only files, unsupported versions, and oversized UTF-8 files', () => {
    expect(() => parseBackup('{broken')).toThrow('not valid JSON');
    expect(() => parseBackup(JSON.stringify(recipe))).toThrow('Recipe-only JSON');
    expect(() => parseBackup(JSON.stringify({ ...fixture(), version: 2 }))).toThrow('backup version');
    expect(() => parseBackup('é'.repeat(MAX_BACKUP_BYTES / 2 + 1))).toThrow('4 MB');
  });

  it('rejects invalid fields with useful paths and refuses unknown backup fields', () => {
    const value = fixture();
    expect(() => parseBackup(JSON.stringify({ ...value, createdAt: 'yesterday' }))).toThrow('createdAt');
    expect(() => parseBackup(JSON.stringify({ ...value, state: { ...value.state, theme: 'blue' } }))).toThrow('state.theme');
    expect(() => parseBackup(JSON.stringify({ ...value, secret: 'unexpected' }))).toThrow('Unrecognized key');
    expect(() => parseBackup(JSON.stringify({ ...value, state: { ...value.state, sessions: { [recipe.id]: { ...value.state.sessions[recipe.id], unexpected: true } } } }))).toThrow('sessions');
  });

  it('rejects duplicate recipe IDs, duplicate shopping recipes, and reserved object keys', () => {
    const value = fixture();
    expect(() => parseBackup(JSON.stringify({ ...value, state: { ...value.state, recipes: [recipe, recipe] } }))).toThrow('Duplicate recipe IDs');
    expect(() => parseBackup(JSON.stringify({ ...value, state: { ...value.state, shoppingPlan: [...value.state.shoppingPlan, ...value.state.shoppingPlan] } }))).toThrow('Duplicate shopping recipe IDs');
    expect(() => parseBackup(JSON.stringify({ ...value, state: { ...value.state, servings: { constructor: 2 } } }))).toThrow('state.servings');
    expect(() => parseBackup(JSON.stringify({ ...value, state: { ...value.state, favorites: [recipe.id, recipe.id] } }))).toThrow('Duplicate IDs');
  });

  it('rejects orphan recipes, ingredients, steps, and timers instead of silently changing imported content', () => {
    const value = fixture();
    const roundTrip = (state: unknown) => parseBackup(JSON.stringify({ ...value, state }));
    expect(() => roundTrip({ ...value.state, shoppingNotes: { missing: 'No such recipe' } })).toThrow('state.shoppingNotes.missing');
    expect(() => roundTrip({ ...value.state, favorites: ['missing'] })).toThrow('state.favorites.0');
    expect(() => roundTrip({ ...value.state, shoppingPlan: [{ recipeId: 'missing', servings: 2 }] })).toThrow('state.shoppingPlan.0.recipeId');
    expect(() => roundTrip({ ...value.state, ingredientChecks: { [recipe.id]: ['missing'] } })).toThrow(`state.ingredientChecks.${recipe.id}.0`);
    const session = value.state.sessions[recipe.id];
    expect(() => roundTrip({ ...value.state, sessions: { [recipe.id]: { ...session, selectedId: 'missing' } } })).toThrow('selectedId');
    expect(() => roundTrip({ ...value.state, sessions: { [recipe.id]: { ...session, completedIds: ['missing'] } } })).toThrow('completedIds.0');
    expect(() => roundTrip({ ...value.state, sessions: { [recipe.id]: { ...session, timers: { missing: createTimer(60000) } } } })).toThrow('timers.missing');
  });

  it('rejects shopping completions for different quantities and hidden items that are not checked', () => {
    const value = fixture();
    const different = shoppingCompletionKey(aggregateShopping(sampleRecipes, [{ recipeId: recipe.id, servings: 12 }])[0]);
    expect(() => parseBackup(JSON.stringify({ ...value, state: { ...value.state, shoppingChecklist: { checked: [different], hidden: [] } } }))).toThrow('current ingredients and servings');
    expect(() => parseBackup(JSON.stringify({ ...value, state: { ...value.state, shoppingChecklist: { checked: [], hidden: value.state.shoppingChecklist.hidden } } }))).toThrow('must also be checked');
  });

  it('keeps the recipe collection inside the existing 2 MB import/export limit', () => {
    const value = fixture();
    const recipes = Array.from({ length: 8 }, (_, index) => ({ ...recipe, id: `large-${index}`, notes: Array.from({ length: 50 }, () => 'é'.repeat(3000)) }));
    const state = normalizeBackupState({ ...value.state, recipes });
    expect(() => serializeBackup({ ...value, state })).toThrow('2 MB recipe collection limit');
  });
});

describe('backup snapshot and restore timing', () => {
  it('cleans stale local references and shopping requirements without mutating the live state', () => {
    const value = fixture();
    const state = value.state;
    const validKey = state.shoppingChecklist.checked[0];
    const before = JSON.stringify(state);
    const stale = {
      ...state,
      favorites: [recipe.id, recipe.id, 'removed'],
      shoppingPlan: [...state.shoppingPlan, ...state.shoppingPlan, { recipeId: 'removed', servings: 2 }],
      servings: { ...state.servings, removed: 2 },
      shoppingNotes: { ...state.shoppingNotes, removed: 'Old note' },
      ingredientChecks: { [recipe.id]: [recipe.ingredients[0].id, 'removed', recipe.ingredients[0].id], removed: ['old'] },
      sessions: {
        [recipe.id]: { ...state.sessions[recipe.id], selectedId: 'removed', completedIds: [recipe.events[0].id, 'removed', recipe.events[0].id], timers: { ...state.sessions[recipe.id].timers, removed: createTimer(60000) } },
        removed: freshSession('old'),
      },
      shoppingChecklist: { checked: [validKey, validKey, 'removed'], hidden: [validKey, 'removed'] },
    };
    const cleaned = normalizeBackupState(stale);
    expect(cleaned.favorites).toEqual([recipe.id]);
    expect(cleaned.shoppingPlan).toEqual(state.shoppingPlan);
    expect(cleaned.servings).toEqual(state.servings);
    expect(cleaned.shoppingNotes).toEqual(state.shoppingNotes);
    expect(cleaned.ingredientChecks).toEqual(state.ingredientChecks);
    expect(cleaned.sessions[recipe.id].selectedId).toBe(recipe.events[0].id);
    expect(cleaned.sessions[recipe.id].completedIds).toEqual([recipe.events[0].id]);
    expect(cleaned.sessions[recipe.id].timers).toEqual(state.sessions[recipe.id].timers);
    expect(Object.keys(cleaned.sessions)).toEqual([recipe.id]);
    expect(cleaned.shoppingChecklist).toEqual(state.shoppingChecklist);
    expect(backupSchema.safeParse({ ...value, state: cleaned }).success).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
    expect(stale.sessions[recipe.id].selectedId).toBe('removed');
  });

  it('freezes running session clocks and concurrent timers at export time, independent of the restore date', () => {
    const value = fixture();
    value.state.sessions[recipe.id].timers[secondTimed.id] = startTimer(createTimer(10000), now - 30000);
    const before = JSON.stringify(value);
    const frozen = pauseBackupSessions(value);
    const session = frozen.state.sessions[recipe.id];
    expect(session.status).toBe('paused');
    expect(session.startedAt).toBeNull();
    expect(session.accumulatedMs).toBe(25000);
    expect(session.timers[timed.id]).toMatchObject({ status: 'paused', remainingMs: 40000, startedAt: null });
    expect(session.timers[secondTimed.id]).toMatchObject({ status: 'finished', remainingMs: 0, startedAt: null });
    expect(getRemainingMs(session.timers[timed.id], now + 86400000)).toBe(40000);
    expect(pauseBackupSessions(frozen)).toEqual(frozen);
    expect(parseBackup(serializeBackup(frozen))).toEqual(frozen);
    expect(JSON.stringify(value)).toBe(before);
  });

  it('preserves idle/paused sessions and timers while stopping running timers in a paused session', () => {
    const value = fixture();
    const session = value.state.sessions[recipe.id];
    session.status = 'paused'; session.startedAt = null;
    session.timers[secondTimed.id] = createTimer(90000);
    const frozen = pauseBackupSessions(value).state.sessions[recipe.id];
    expect(frozen.accumulatedMs).toBe(session.accumulatedMs);
    expect(frozen.timers[timed.id].status).toBe('paused');
    expect(frozen.timers[secondTimed.id]).toEqual(session.timers[secondTimed.id]);
    value.state.sessions[recipe.id] = freshSession(timed.id);
    expect(pauseBackupSessions(value).state.sessions[recipe.id]).toEqual(freshSession(timed.id));
  });
});
