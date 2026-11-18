import { z } from 'zod';
import { sampleRecipes } from '../data';
import { recipeSchema, type Recipe } from '../domain/schema';
import { validateCollectionSize } from '../domain/importExport';
import { updateShoppingNote, type ShoppingNotes } from '../domain/shoppingNotes';
import { bytes, keyOf, same, uploadProblem, type ExchangeRequest, type Kind, type Operation, type Page, type Snapshot, type Space, type Value } from './protocol';

type RecordContent = Pick<Snapshot, 'kind' | 'recordId' | 'schemaVersion' | 'value' | 'deleted'>;
type Acknowledgement = Pick<Snapshot, 'serverVersion' | 'people' | 'deleted'>;
export type Scope = { owner: string; appId: 'recipes'; spaceId: string };
type Pending = { scope: Scope; device: string; id: string; kind: Kind; recordId: string; value: Value | null; operation?: Operation };
export type Review = { generation: string; kind: string; id: string; reason: string; local: unknown; remote: Snapshot | null };
export interface Cookbook {
  revision: number;
  device: string;
  scope: Scope | null;
  recipes: Recipe[];
  privateNotes: ShoppingNotes;
  sharedNotes: ShoppingNotes;
  shareNotes: string[];
  privateRecipes: string[];
  phase: 'local' | 'staging' | 'preview' | 'ready';
  remote: Record<string, Snapshot>;
  staged: Record<string, Snapshot>;
  awaitingSnapshots: Record<string, Acknowledgement>;
  continuation: boolean;
  freshPullRequired: boolean;
  cursor: string | null;
  directoryCursor?: string | null;
  directoryChecked?: number;
  boundSpace?: Space;
  pending: Pending[];
  reviews: Record<string, Review>;
  lastSuccess: number;
  retryAt: number;
  rateLimitUntil?: number;
  failures: number;
  issue: string;
  catchUp: boolean;
  migrationWarning: string;
  restoreId?: string;
}
export function fresh(): Cookbook {
  return { revision: 0, device: crypto.randomUUID(), scope: null, recipes: structuredClone(sampleRecipes), privateNotes: {}, sharedNotes: {}, shareNotes: [], privateRecipes: [], phase: 'local', remote: {}, staged: {}, awaitingSnapshots: {}, continuation: false, freshPullRequired: false, cursor: null, pending: [], reviews: {}, lastSuccess: 0, retryAt: 0, failures: 0, issue: '', catchUp: false, migrationWarning: '' };
}
export function stageAgain(s: Cookbook) {
  s.staged = {}; s.cursor = null; s.phase = 'staging'; s.catchUp = true; s.lastSuccess = 0;
}
export function localValue(s: Cookbook, kind: string, id: string): Value | null {
  if (kind === 'recipe') return s.recipes.find(r => r.id === id) ?? null;
  return kind === 'shopping-note' && Object.hasOwn(s.sharedNotes, id) ? { note: s.sharedNotes[id] } : null;
}
function review(s: Cookbook, kind: string, id: string, reason: string, remote: Snapshot | null) {
  s.reviews[keyOf(kind, id)] = { generation: crypto.randomUUID(), kind, id, reason, local: localValue(s, kind, id), remote };
}
const forKey = (p: Pending, kind: string, id: string) => p.kind === kind && p.recordId === id;
function materialize(p: Pending, base: string | null, remote?: Pick<Snapshot, 'people'>, resurrect = false): Operation {
  const common = { operationId: p.id, kind: p.kind, recordId: p.recordId, baseServerVersion: base };
  return p.value === null ? { ...common, type: 'delete' } : { ...common, type: 'put', schemaVersion: 1, value: p.value, people: remote?.people ?? [], ...(resurrect ? { resurrect: true } : {}) };
}
function enqueue(s: Cookbook, kind: Kind, recordId: string, value: Value | null, resurrect = false) {
  if (!s.scope || s.phase !== 'ready') return;
  const key = keyOf(kind, recordId);
  const remote = s.remote[key];
  const base = s.awaitingSnapshots[key] ?? remote;
  const tail = s.pending.some(p => forKey(p, kind, recordId));
  if (!tail && !base && value === null && !s.reviews[key]) return;
  const p: Pending = { scope: { ...s.scope }, device: s.device, id: crypto.randomUUID(), kind, recordId, value };
  if (!tail) p.operation = materialize(p, base?.serverVersion ?? null, base, resurrect);
  s.pending.push(p);
  s.catchUp = true;
  if (s.reviews[key]) review(s, kind, recordId, s.reviews[key].reason, s.reviews[key].remote);
  else if (base?.deleted && value && !resurrect) review(s, kind, recordId, 'This record was deleted in the Space. Review before restoring it.', remote ?? null);
  else if (p.operation) {
    const issue = uploadProblem(p.operation);
    if (issue) review(s, kind, recordId, issue, remote ?? null);
  }
}
export function editRecipes(s: Cookbook, before: Recipe[], after: Recipe[]) {
  if (!same(before, s.recipes)) throw new Error('The library changed in another tab or device. Review the import again.');
  if (new Set(after.map(r => r.id)).size !== after.length) throw new Error('Duplicate recipe IDs.');
  validateCollectionSize(after);
  s.recipes = after;
  for (const recipe of after) {
    if (!same(recipe, before.find(r => r.id === recipe.id))) {
      s.privateRecipes = s.privateRecipes.filter(id => id !== recipe.id);
      enqueue(s, 'recipe', recipe.id, recipe);
    }
  }
  for (const prior of before) {
    if (after.some(r => r.id === prior.id)) continue;
    if (!s.privateRecipes.includes(prior.id)) enqueue(s, 'recipe', prior.id, null);
    delete s.privateNotes[prior.id]; // The local removal dialog explicitly includes the personal note.
  }
}
export function visibleNotes(s: Cookbook) { return { ...s.sharedNotes, ...s.privateNotes }; }
export function editNote(s: Cookbook, id: string, note: string, expected: string, expectedShared: boolean) {
  if (((expectedShared ? s.sharedNotes : s.privateNotes)[id] ?? '') !== expected || s.shareNotes.includes(id) !== expectedShared) throw new Error('The reminder changed. Reopen it to review the current text.');
  if (s.shareNotes.includes(id)) {
    s.sharedNotes = updateShoppingNote(s.sharedNotes, id, note);
    enqueue(s, 'shopping-note', id, localValue(s, 'shopping-note', id));
  } else {
    s.privateNotes = updateShoppingNote(s.privateNotes, id, note);
  }
}
export function shareRecipe(s: Cookbook, id: string) {
  const recipe = s.recipes.find(r => r.id === id);
  if (!recipe || !s.privateRecipes.includes(id) || s.phase !== 'ready') return;
  s.privateRecipes = s.privateRecipes.filter(x => x !== id);
  enqueue(s, 'recipe', id, recipe);
}
export function shareNote(s: Cookbook, id: string) {
  if (s.phase !== 'ready' || s.shareNotes.includes(id)) return;
  s.shareNotes.push(id);
  const note = s.privateNotes[id];
  if (!note) return;
  delete s.privateNotes[id];
  s.sharedNotes[id] = note;
  const remote = s.remote[keyOf('shopping-note', id)];
  if (remote && !same(remote.value, { note })) review(s, 'shopping-note', id, 'Your reminder and the shared reminder differ.', remote);
  else if (!remote) enqueue(s, 'shopping-note', id, { note });
}
export function candidate(s: Cookbook, row: RecordContent): string {
  if (row.schemaVersion !== 1 || !recipeSchema.shape.id.safeParse(row.recordId).success || !['recipe', 'shopping-note'].includes(row.kind)) return 'Unsupported record format. Export the raw copy for review.';
  if (row.deleted) return row.value === null ? '' : 'Invalid deletion record.';
  if (row.kind === 'recipe') {
    const parsed = recipeSchema.safeParse(row.value);
    if (!parsed.success || parsed.data.id !== row.recordId) return 'This recipe uses an unsupported format. The original is available for export.';
    try { validateCollectionSize([...s.recipes.filter(r => r.id !== row.recordId), parsed.data]); }
    catch { return 'This recipe would exceed the local collection limit. Export it or make room in the library.'; }
  } else if (!z.object({ note: z.string().trim().min(1).max(500) }).strict().safeParse(row.value).success) return 'The reminder has unsupported fields. Export its original for review.';
  return '';
}
function install(s: Cookbook, kind: string, id: string, row: RecordContent | null) {
  const problem = row && candidate(s, row);
  if (problem) throw new Error(problem);
  if (kind === 'recipe') {
    const at = s.recipes.findIndex(r => r.id === id);
    if (!row || row.deleted) { if (at >= 0) s.recipes.splice(at, 1); }
    else if (at >= 0) s.recipes[at] = row.value as Recipe;
    else s.recipes.push(row.value as Recipe);
    s.privateRecipes = s.privateRecipes.filter(x => x !== id);
  } else if (kind === 'shopping-note') {
    if (row && !row.deleted) s.sharedNotes[id] = (row.value as { note: string }).note;
    else delete s.sharedNotes[id];
  }
}
type Protected = (id: string) => boolean;
function receive(s: Cookbook, row: Snapshot, protectedProgress: Protected, initial = false) {
  const key = keyOf(row.kind, row.recordId);
  const awaiting = s.awaitingSnapshots[key];
  if (awaiting) {
    if (BigInt(row.serverVersion) < BigInt(awaiting.serverVersion)) return;
    delete s.awaitingSnapshots[key];
  }
  const prior = s.remote[key];
  if (!initial && prior && BigInt(prior.serverVersion) > BigInt(row.serverVersion)) return;
  s.remote[key] = row;
  const local = localValue(s, row.kind, row.recordId);
  const pending = s.pending.some(p => forKey(p, row.kind, row.recordId));
  const existing = s.reviews[key];
  const problem = candidate(s, row);
  if (existing || problem) {
    if (!existing?.remote || initial || BigInt(existing.remote.serverVersion) <= BigInt(row.serverVersion)) review(s, row.kind, row.recordId, problem || existing.reason, row);
    return;
  }
  if (pending) return; // A pending head retains its original base and will get a server conflict if stale.
  if (same(local, row.value)) {
    if (row.kind === 'recipe') s.privateRecipes = s.privateRecipes.filter(id => id !== row.recordId);
    return;
  }
  const needsRecipeReview = row.kind === 'recipe' && (row.deleted || s.privateRecipes.includes(row.recordId) || protectedProgress(row.recordId));
  if (local && (initial || needsRecipeReview)) {
    review(s, row.kind, row.recordId, row.deleted ? 'Deleted in the shared Space. Review the local copy and any cooking progress.' : 'The shared copy differs from your local copy. Review before replacing it.', row);
  } else install(s, row.kind, row.recordId, row);
}
export function reconcile(s: Cookbook, recipes: string[], notes: string[], protectedProgress: Protected) {
  if (s.phase !== 'preview') throw new Error('Wait for the complete Space download.');
  const oldRemote = s.remote;
  s.remote = {}; s.awaitingSnapshots = {}; s.continuation = false; s.freshPullRequired = false;
  s.phase = 'ready';
  const priorReviews = s.reviews;
  s.reviews = {};
  for (const p of s.pending) review(s, p.kind, p.recordId, 'Previously queued work needs review before another upload.', s.staged[keyOf(p.kind, p.recordId)] ?? null);
  for (const old of Object.values(priorReviews)) review(s, old.kind, old.id, old.reason, s.staged[keyOf(old.kind, old.id)] ?? null);
  for (const row of Object.values(s.staged)) receive(s, row, protectedProgress, true);
  for (const r of s.recipes) {
    const key = keyOf('recipe', r.id);
    if (s.staged[key] || s.reviews[key]) continue;
    if (recipes.includes(r.id)) enqueue(s, 'recipe', r.id, r);
    else if (!s.privateRecipes.includes(r.id)) s.privateRecipes.push(r.id);
  }
  for (const [key, prior] of Object.entries(oldRemote)) {
    if (!s.staged[key] && !s.reviews[key] && localValue(s, prior.kind, prior.recordId) && prior.kind === 'shopping-note')
      review(s, prior.kind, prior.recordId, 'The previous shared reminder is absent from this download.', null);
  }
  for (const id of notes) shareNote(s, id);
  s.staged = {}; s.catchUp = true;
}
export function resolveReview(s: Cookbook, displayed: Review, choice: 'local' | 'server' | 'queued') {
  const { kind, id, remote } = displayed;
  const key = keyOf(kind, id);
  if (s.phase !== 'ready' || displayed.generation !== s.reviews[key]?.generation) throw new Error('The comparison changed. Review both copies again.');
  if (s.awaitingSnapshots[key]) throw new Error('Wait for the acknowledged shared copy to finish downloading.');
  if (choice === 'queued') {
    const queued = s.pending.filter(p => forKey(p, kind, id)).at(-1);
    if (!queued) throw new Error('The queued copy changed. Review it again.');
    install(s, kind, id, { kind, recordId: id, schemaVersion: 1, value: queued.value, deleted: queued.value === null });
  } else if (choice === 'server') {
    if (remote) install(s, kind, id, remote);
    else if (kind === 'recipe' && localValue(s, kind, id) && !s.privateRecipes.includes(id)) s.privateRecipes.push(id);
    else if (kind === 'shopping-note') {
      if (s.sharedNotes[id] && !s.privateNotes[id]) s.privateNotes[id] = s.sharedNotes[id];
      delete s.sharedNotes[id];
      s.shareNotes = s.shareNotes.filter(noteId => noteId !== id);
    }
  }
  else if (!['recipe', 'shopping-note'].includes(kind)) throw new Error('Export this unsupported record for review.');
  s.pending = s.pending.filter(p => !forKey(p, kind, id));
  delete s.reviews[key];
  if (remote) s.remote[key] = remote; else delete s.remote[key];
  if (choice !== 'server') {
    const local = localValue(s, kind, id);
    if (local || remote && !remote.deleted) enqueue(s, kind as Kind, id, local, !!remote?.deleted);
  }
  s.catchUp = true;
}
export function exchangeRequest(s: Cookbook): ExchangeRequest {
  if (!s.scope) throw new Error('Select a shared Space first.');
  const req: ExchangeRequest = { protocolVersion: 1, appId: 'recipes', deviceId: s.device, spaceId: s.scope.spaceId, cursor: s.cursor, limit: 25, changes: [] };
  if (s.phase !== 'ready') return req;
  for (const p of s.pending) {
    if (!same(p.scope, s.scope) || p.device !== s.device) throw new Error('Queued work belongs to a different device or Space.');
    if (!p.operation || s.reviews[keyOf(p.kind, p.recordId)]) continue;
    if (uploadProblem(p.operation)) throw new Error('Queued operation requires review.');
    req.changes.push(p.operation);
    if (bytes(req) > 1048576) { req.changes.pop(); break; }
    if (req.changes.length === 32) break;
  }
  return req;
}
export function applyPage(s: Cookbook, request: ExchangeRequest, page: Page, protectedProgress: Protected) {
  if (s.cursor !== request.cursor || s.scope?.spaceId !== request.spaceId || !['ready', 'staging'].includes(s.phase)) throw new Error('The sync preview changed. Retry.');
  if (page.results.length !== request.changes.length || page.results.some((r, i) => r.operationId !== request.changes[i].operationId)) throw new Error('Incomplete acknowledgements. Changes retained for retry.');
  if (page.hasMore && page.cursor === request.cursor) throw new Error('The download cursor did not advance.');
  s.cursor = page.cursor; s.rateLimitUntil = 0; s.failures = 0; s.retryAt = 0; s.issue = '';
  if (s.phase === 'staging') {
    for (const row of page.changes) s.staged[keyOf(row.kind, row.recordId)] = row;
    if (!page.hasMore) s.phase = 'preview';
    return;
  }
  for (const [i, result] of page.results.entries()) {
    const op = request.changes[i];
    const key = keyOf(op.kind, op.recordId);
    const head = s.pending.find(p => p.id === op.operationId);
    if (!head || !same(head.operation, op)) throw new Error('Queued operation changed. Download again.');
    if (result.status !== 'accepted') {
      const current = result.status === 'conflict' ? result.current : s.remote[key] ?? null;
      review(s, op.kind, op.recordId, result.status === 'conflict' ? 'Both devices changed this record.' : 'The service declined this change (' + result.code + ').', current);
      continue;
    }
    s.pending.splice(s.pending.indexOf(head), 1);
    const next = s.pending.find(p => forKey(p, op.kind, op.recordId));
    if (next) {
      next.operation = materialize(next, result.serverVersion, s.remote[key]);
      const problem = uploadProblem(next.operation);
      if (problem || op.type === 'delete' && next.value) review(s, op.kind, op.recordId, problem || 'Review before restoring a deleted record.', s.remote[key] ?? null);
    }
    // Acknowledgement supplies a base version, but only a downloaded snapshot supplies audit metadata.
    if (!s.remote[key] || BigInt(result.serverVersion) > BigInt(s.remote[key].serverVersion)) {
      s.awaitingSnapshots[key] = { serverVersion: result.serverVersion, deleted: head.value === null,
        people: op.type === 'put' ? op.people : s.remote[key]?.people ?? [] };
    }
  }
  for (const row of page.changes) receive(s, row, protectedProgress);
  if (request.changes.length) s.freshPullRequired = true;
  else if (!s.continuation) s.freshPullRequired = false;
  s.continuation = page.hasMore;
  s.catchUp = page.hasMore || s.freshPullRequired || Object.keys(s.awaitingSnapshots).length > 0;
  if (!s.catchUp && !s.pending.length && !Object.keys(s.reviews).length) s.lastSuccess = Date.now();
}
