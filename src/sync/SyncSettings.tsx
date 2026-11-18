import { useEffect, useState, useSyncExternalStore } from 'react';
import { RefreshCw } from 'lucide-react';
import { activity, afterSave, approve, connect, createHouseholdSpace, loadSpaces, login, logout, resolve, run, selectNote, status, subscribeActivity } from './engine';
import { candidate, localValue, shareRecipe, type Cookbook, type Review } from './model';
import { keyOf, same } from './protocol';
import { change, downloadJson, recoveryExport, snapshot, subscribe } from './store';
import './sync.css';

export function SyncButton({ open }: { open: () => void }) {
  useSyncExternalStore(subscribeActivity, activity);
  const s = useSyncExternalStore(subscribe, snapshot);
  const label = status();
  return <div className="sync-header"><button className="btn btn-secondary" title={label} onClick={() => {
    if (!s.scope || label === 'Attention needed' || label === 'Sign in required') open();
    void run(true, true);
  }}><RefreshCw size={15} aria-hidden="true"/>Sync</button><small aria-live="polite">{s.scope ? label : ''}</small></div>;
}
type Action = (fn: () => Promise<unknown>) => void;
function Preview({ s, act }: { s: Cookbook; act: Action }) {
  const [uploads, setUploads] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const rows = Object.values(s.staged);
  const locals = s.recipes.filter(r => !s.staged[keyOf('recipe', r.id)]);
  const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(x => x !== id) : [...values, id];
  return <section><h3>Review this Space</h3>
    <p>{rows.length} shared records downloaded. Exact matches link automatically. Different versions stay available for review.</p>
    <ul>{rows.map(row => {
      const local = localValue(s, row.kind, row.recordId);
      return <li key={keyOf(row.kind, row.recordId)}>{row.kind === 'shopping-note' ? 'Reminder' : 'Recipe'} · {row.recordId} — {candidate(s, row) || (row.deleted ? 'Shared deletion' : same(local, row.value) ? 'Exact match' : local ? 'Different versions' : 'Download')}</li>;
    })}</ul>
    {locals.length > 0 && <fieldset><legend>Upload selected local recipes</legend>{locals.map(r => <label key={r.id}><input type="checkbox" checked={uploads.includes(r.id)} onChange={() => setUploads(toggle(uploads, r.id))}/>{r.name}</label>)}</fieldset>}
    {Object.keys(s.privateNotes).length > 0 && <fieldset><legend>Share selected personal reminders</legend>{Object.entries(s.privateNotes).map(([id, note]) => <label key={id}><input type="checkbox" checked={notes.includes(id)} onChange={() => setNotes(toggle(notes, id))}/>{s.recipes.find(r => r.id === id)?.name ?? id} · {note}</label>)}</fieldset>}
    <p>Unselected local recipes and reminders stay private. After connecting, confirmed recipe imports and replacements are shared automatically.</p>
    <button className="btn btn-primary" onClick={() => act(() => approve(s.revision, uploads, notes))}>Apply choices and connect</button>
  </section>;
}
function Comparison({ row, s, act }: { row: Review; s: Cookbook; act: Action }) {
  const local = row.local; const remote = row.remote?.value ?? null;
  const queued = s.pending.filter(p => p.recordId === row.id && p.kind === row.kind).at(-1);
  const differentQueue = queued && !same(queued.value, local);
  const fields = local && remote && typeof local === 'object' && typeof remote === 'object'
    ? [...new Set([...Object.keys(local), ...Object.keys(remote)])].filter(k => !same((local as Record<string, unknown>)[k], (remote as Record<string, unknown>)[k])) : [];
  const scalarChanges = fields.flatMap(field => {
    const before = (local as Record<string, unknown>)[field];
    const after = (remote as Record<string, unknown>)[field];
    if ([before, after].some(v => v != null && typeof v === 'object')) return [];
    return [{ field, before: String(before ?? 'Unset'), after: String(after ?? 'Unset') }];
  });
  return <section className="sync-comparison"><h4>{row.kind === 'recipe' ? 'Recipe' : 'Reminder'} · {row.id}</h4><p>{row.reason}</p>
    {fields.length > 0 && <p>Changed fields · {fields.join(', ')}</p>}
    {scalarChanges.map(({field,before,after}) => <dl className="sync-difference" key={field}>
      <dt>{field} on this device</dt><dd>{before}</dd><dt>{field} in the shared Space</dt><dd>{after}</dd>
    </dl>)}
    {row.kind === 'recipe' && <p>Accepting the shared version can change the steps or ingredients shown on this device. Saved progress and personal reminders remain in recovery copies.</p>}
    <div className="sync-copies">{[['This device', local], ['Shared Space', remote]].map(([name, value]) => <details key={String(name)}><summary>{String(name)}</summary><pre>{value ? JSON.stringify(value, null, 2) : 'No current record'}</pre></details>)}</div>
    {differentQueue && <details><summary>Previously queued on this device</summary><pre>{JSON.stringify(queued.value, null, 2) ?? 'Deletion'}</pre><button className="btn btn-secondary" onClick={() => act(() => resolve(row, 'queued'))}>Use previously queued version</button></details>}
    <button className="btn btn-secondary" onClick={() => downloadJson('countertop-comparison.json', { ...row, queued: queued?.value })}>Export both copies</button>
    {['recipe', 'shopping-note'].includes(row.kind) && <button className="btn btn-secondary" onClick={() => act(() => resolve(row, 'local'))}>{row.remote?.deleted && local ? 'Restore local copy to Space' : !local && remote ? 'Delete the shared copy' : 'Use local version in Space'}</button>}
    {(!row.remote || !candidate(s, row.remote)) && <button className="btn btn-secondary" onClick={() => act(() => resolve(row, 'server'))}>{!row.remote ? 'Keep on this device' : row.remote.deleted ? 'Accept deletion on this device' : 'Use shared version on this device'}</button>}
  </section>;
}
export function SyncSettings({ onBackup }: { onBackup: () => void }) {
  const s = useSyncExternalStore(subscribe, snapshot);
  const a = useSyncExternalStore(subscribeActivity, activity);
  const [expanded, setExpanded] = useState(location.hash === '#/settings/sync');
  const [password, setPassword] = useState('');
  const [space, setSpace] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not complete this change.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const open = () => { if (location.hash === '#/settings/sync') { setExpanded(true); document.getElementById('advanced-sync')?.scrollIntoView(); } };
    open(); window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, []);
  useEffect(() => {
    if (expanded && a.signedIn) void loadSpaces().catch(err => setError(String(err)));
  }, [expanded, a.signedIn]);
  const chosen = space || s.scope?.spaceId || a.spaces[0]?.id || '';
  return <details className="data-section card sync-settings" id="advanced-sync" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
    <summary>Advanced sync settings</summary>
    <p role="status">{status()}{s.lastSuccess > 0 && ' · Last synced ' + new Date(s.lastSuccess).toLocaleString()}</p>
    <fieldset disabled={busy} className="sync-controls">
      <div className="sync-tools"><button className="btn btn-secondary" onClick={() => act(async () => onBackup())}>Save cookbook backup</button>
      <button className="btn btn-secondary" onClick={() => act(async () => downloadJson('countertop-sync-recovery.json', await recoveryExport()))}>Download recovery copies</button></div>
      {s.migrationWarning && <p>{s.migrationWarning}</p>}
      {!a.signedIn ? <form onSubmit={e => { e.preventDefault(); const entered = password; setPassword(''); void act(() => login(entered)); }}>
        <label>Household password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required/></label><button className="btn btn-primary">Sign in</button>
      </form> : <><p>Signed in to your household. <button className="text-button" onClick={() => act(logout)}>Sign out</button></p>
      {!s.scope ? <section><h3>Connect a shared Space</h3>
        {a.spaces.length ? <><label>Shared Space<select value={chosen} onChange={e => setSpace(e.target.value)}>{a.spaces.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}</select></label>
        <button className="btn btn-secondary" onClick={() => act(() => connect(chosen))}>Preview shared cookbook</button></> : <><p>No active shared Space is listed.</p><button className="btn btn-secondary" onClick={() => act(createHouseholdSpace)}>Create household Space</button></>}
      </section> : <section><p>Shared Space · {a.spaces.find(sp => sp.id === s.scope?.spaceId)?.name ?? s.scope.spaceId}</p>
        {a.spaces.some(sp => sp.id !== s.scope?.spaceId) && <details><summary>Change Space</summary>
          <p>This device keeps each Space’s cookbook, queued changes, notes and cooking progress separately. Returning to a Space resumes its queue.</p>
          <label>Destination Space<select value={chosen} onChange={e => setSpace(e.target.value)}>{a.spaces.map(sp => <option key={sp.id} value={sp.id}>{sp.name}</option>)}</select></label>
          <button className="btn btn-secondary" disabled={chosen === s.scope.spaceId} onClick={() => act(async () => { location.hash='/settings/sync'; await connect(chosen, s); setSpace(''); })}>Switch cookbook Space</button>
        </details>}</section>}</>}
      {s.phase === 'staging' && <p>Downloading the Space for comparison. Local changes are safe.</p>}
      {a.signedIn && s.phase === 'preview' && <Preview key={s.revision} s={s} act={act}/>}
      {s.phase === 'ready' && <>
        {Object.values(s.reviews).map(row => <Comparison key={row.generation} s={s} row={row} act={act}/>)}
        {s.privateRecipes.length > 0 && <section><h3>Recipes kept on this device</h3>{s.recipes.filter(r => s.privateRecipes.includes(r.id)).map(r => <button key={r.id} className="btn btn-secondary" onClick={() => act(async () => {
          await change(state => {
            if (state.revision !== s.revision) throw new Error('The library changed. Review again.');
            shareRecipe(state, r.id);
          }); afterSave();
        })}>Share {r.name}</button>)}</section>}
        {Object.entries({...s.sharedNotes,...s.privateNotes}).some(([id]) => !s.recipes.some(r => r.id === id)) &&
          <section><h3>Reminders for missing recipes</h3>{Object.entries({...s.sharedNotes,...s.privateNotes}).filter(([id]) => !s.recipes.some(r => r.id === id)).map(([id,note]) => <p key={id}>{id} · {note}</p>)}</section>}
        <fieldset><legend>Share edits to these shopping reminders</legend><p>Turning sharing off keeps future edits on this device. The last shared reminder stays in the Space.</p>
          {s.recipes.map(r => <label key={r.id}><input type="checkbox" checked={s.shareNotes.includes(r.id)} onChange={e => { const checked = e.target.checked; void act(() => selectNote(r.id, checked, s.revision)); }}/>{r.name}</label>)}
        </fieldset>
      </>}
      {(error || a.error || s.issue) && <p role="alert">{error || a.error || s.issue}</p>}
    </fieldset>
  </details>;
}
