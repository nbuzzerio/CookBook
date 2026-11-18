import { ApiError, SyncApi } from './api';
import { applyPage, exchangeRequest, reconcile, resolveReview, shareNote, stageAgain, type Review } from './model';
import { same, spaceSchema, type Space } from './protocol';
import { RESTORE_JOURNAL_KEY } from '../storage/backup';
import { change, hasProgress, refresh, snapshot, switchLibrary, syncLock } from './store';

const api = new SyncApi();
const sessionChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('household-session');
let info = { working: false, signedIn: false, signedOut: false, error: '', spaces: [] as Space[], offline: !navigator.onLine };
const listeners = new Set<() => void>();
export const activity = () => info;
export const subscribeActivity = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function update(patch: Partial<typeof info> = {}) {
  info = { ...info, signedIn: !!api.session, signedOut: api.authState === 'signed-out', offline: !navigator.onLine, ...patch };
  listeners.forEach(fn => fn());
}
let active: Promise<void> | undefined;
let scheduled: ReturnType<typeof setTimeout>;
export function afterSave() { clearTimeout(scheduled); scheduled = setTimeout(() => void run(), 180); }
let authRetryAt = 0;
function message(error: unknown) {
  return error instanceof SyntaxError ? 'The sync service is unavailable at this address.' : error instanceof Error ? error.message : 'Could not reach the sync service.';
}
async function refreshDirectory(spaceId: string) {
  while (true) {
    const cursor = snapshot().directoryCursor ?? null;
    try {
      const page = await api.directoryChanges(cursor);
      if (page.hasMore && page.cursor === cursor) throw new Error('The directory cursor did not advance.');
      await change(state => {
        for (const item of page.changes) {
          if (item.entityType !== 'space') continue;
          const space = spaceSchema.parse(item.value);
          if (space.id === spaceId) state.boundSpace = space;
        }
        state.directoryCursor = page.cursor;
        if (!page.hasMore) state.directoryChecked = Date.now();
      });
      if (!page.hasMore) return;
    } catch (err) {
      if (!cursor || !(err instanceof ApiError && err.code === 'CURSOR_RESET_REQUIRED')) throw err;
      await change(state => { state.directoryCursor = null; state.directoryChecked = 0; delete state.boundSpace; });
    }
  }
}
async function pass(force: boolean, checkSession: boolean) {
  if (!navigator.onLine) { update(); return; }
  await syncLock(async () => {
    let s = await refresh();
    if (!s || (s.rateLimitUntil ?? 0) > Date.now() || (!force && document.hidden) || (s.retryAt > Date.now() && !checkSession) || authRetryAt > Date.now()) return;
    if (!s.scope && !checkSession && !force) return;
    if (localStorage.getItem(RESTORE_JOURNAL_KEY) !== null) {
      update({ error: 'Reload to recover the interrupted cookbook restore.' });
      return;
    }
    update({ working: true, error: '' });
    try {
      if (!api.session || checkSession) await api.restore();
      update();
      if (!s.scope) return;
      if (api.session!.principalId !== s.scope.owner) throw new Error('Sign in with the household that owns this Space.');
      if (checkSession || !s.directoryChecked || Date.now() - s.directoryChecked >= 60000) {
        await refreshDirectory(s.scope.spaceId);
        s = snapshot();
      }
      if (!s.boundSpace || s.boundSpace.archived || s.boundSpace.kind !== 'shared') throw new Error('This Space is unavailable for sharing. Choose an active shared Space.');
      if (s.phase === 'preview') return;
      for (let i = 0; i < 16; i++) {
        const req = exchangeRequest(s);
        try {
          const page = await api.exchange(req);
          await change(state => applyPage(state, req, page, hasProgress));
          s = snapshot();
          if (s.phase === 'preview' || (s.phase === 'ready' && !s.catchUp && !exchangeRequest(s).changes.length)) return;
        } catch (err) {
          if (!(err instanceof ApiError && err.code === 'CURSOR_RESET_REQUIRED')) throw err;
          await change(stageAgain, 'Before downloading replacement history');
          s = snapshot();
        }
      }
      afterSave();
    } catch (error) {
      const reason = message(error);
      if (error instanceof ApiError && error.retryAfter) authRetryAt = Date.now() + error.retryAfter;
      if (s.scope) {
        await change(state => {
          state.issue = reason; state.failures++;
          if (error instanceof ApiError && error.status === 429) state.rateLimitUntil = Date.now() + (error.retryAfter || 1000);
          state.retryAt = Date.now() + Math.max(error instanceof ApiError ? error.retryAfter : 0, Math.min(60000, 1000 * 2 ** Math.min(state.failures, 6)));
        });
        if (!(error instanceof ApiError && error.status === 401)) {
          clearTimeout(scheduled);
          scheduled = setTimeout(() => void run(), Math.max(100, snapshot().retryAt - Date.now() + 50));
        }
      }
      update({ error: reason, spaces: api.session ? info.spaces : [] });
    }
  });
}
export async function run(force = false, checkSession = false): Promise<void> {
  if (active) { await active; if (force) await run(true, checkSession); return; }
  active = pass(force, checkSession).catch(err => update({ error: message(err) })).finally(() => { active = undefined; update({ working: false }); });
  await active;
}
export async function loadSpaces() {
  if (!api.session) await api.restore();
  update({ spaces: await api.spaces(), error: '' });
}
export async function login(password: string) {
  if (Date.now() < authRetryAt) throw new Error('Please wait before trying the household password again.');
  try {
    await api.login(password);
    sessionChannel?.postMessage('changed');
    await loadSpaces();
    if (snapshot().scope) { await change(s => { s.retryAt = 0; }); await run(true); }
  } catch (err) {
    if (err instanceof ApiError) authRetryAt = Date.now() + err.retryAfter;
    throw err;
  } finally { update(); }
}
export async function logout() {
  await syncLock(() => api.logout());
  sessionChannel?.postMessage('changed');
  update({ spaces: [], error: '' });
}
export async function createHouseholdSpace() {
  await syncLock(async () => {
    await loadSpaces();
    if (info.spaces.length) return;
    // Stable across devices and lost responses for this owner's initial shared Space.
    const seed = new TextEncoder().encode('countertop:household-space:' + api.session!.principalId);
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', seed)).slice(0, 16);
    hash[6] = (hash[6] & 15) | 0x40;
    hash[8] = (hash[8] & 63) | 0x80;
    const hex = Array.from(hash, b => b.toString(16).padStart(2, '0')).join('');
    const id = [hex.slice(0,8), hex.slice(8,12), hex.slice(12,16), hex.slice(16,20), hex.slice(20)].join('-');
    try { await api.call('/spaces', { id, name: 'Household', kind: 'shared' }); }
    catch (err) { if (!(err instanceof ApiError && err.code === 'ID_EXISTS')) throw err; }
    await loadSpaces();
    if (!info.spaces.length) throw new Error('The household Space is archived. Choose an active Space in the service directory.');
  });
}
export async function connect(id: string, expected = snapshot()) {
  await syncLock(async () => {
    await loadSpaces();
    const space = info.spaces.find(item => item.id === id);
    if (!space || !api.session) throw new Error('Choose an active shared Space.');
    const scope = { appId: 'recipes' as const, spaceId: id, owner: api.session.principalId };
    if (expected.scope && !same(expected.scope, scope)) {
      await switchLibrary(expected, scope);
      return;
    }
    await change(s => {
      if (s.scope && !same(s.scope, scope)) throw new Error('The active Space changed. Review the selected Space again.');
      if (!s.scope) { s.scope = scope; s.boundSpace = space; stageAgain(s); }
    }, 'Before connecting this cookbook');
  });
  await run(true);
}
export async function approve(revision: number, recipes: string[], notes: string[]) {
  await syncLock(() => change(s => {
    if (revision !== s.revision) throw new Error('The preview changed. Review it again.');
    reconcile(s, recipes, notes, hasProgress);
  }, 'Before applying the connection preview'));
  await run(true);
}
export async function resolve(displayed: Review, choice: 'local' | 'server' | 'queued') {
  await syncLock(() => change(s => resolveReview(s, displayed, choice), 'Before resolving ' + displayed.kind + ' ' + displayed.id));
  await run(true);
}
export async function selectNote(id: string, sharing: boolean, revision: number) {
  await change(s => {
    if (s.revision !== revision) throw new Error('The note changed. Review it again.');
    if (sharing) shareNote(s, id);
    else {
      s.shareNotes = s.shareNotes.filter(x => x !== id);
      if (s.sharedNotes[id]) s.privateNotes[id] = s.sharedNotes[id];
    }
  });
  afterSave();
}
export function startSync() {
  const foreground = () => { if (!document.hidden) void run(false, true); };
  window.addEventListener('online', foreground);
  window.addEventListener('offline', () => update());
  document.addEventListener('visibilitychange', foreground);
  sessionChannel?.addEventListener('message', () => void run(true, true));
  setInterval(() => { if (snapshot()?.scope && !document.hidden) void run(); }, 60000);
  void run(false, true);
}
export function status() {
  const s = snapshot();
  if (info.offline) return 'Offline';
  if (info.working) return 'Syncing';
  if (info.signedOut) return 'Sign in required';
  if (s.issue || info.error || Object.keys(s.reviews).length || s.phase === 'preview') return 'Attention needed';
  if (!s.scope) return 'Device only';
  if (s.pending.length || s.catchUp || !s.lastSuccess) return 'Changes pending';
  return 'Synced';
}
