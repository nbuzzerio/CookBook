import { describe, expect, it } from 'vitest';
import { sampleRecipes } from '../data';
import { exportRecipes, mergeRecipes, parseRecipeImport } from '../domain/importExport';
import { applyPage, editNote, editRecipes, exchangeRequest, fresh, reconcile, resolveReview, shareNote, stageAgain, type Cookbook } from './model';
import { bytes, keyOf, same, type Operation, type Page, type Snapshot } from './protocol';

const recipe = sampleRecipes[0];
const scope = { owner: crypto.randomUUID(), appId: 'recipes' as const, spaceId: crypto.randomUUID() };
function library() { const s = fresh(); s.scope = scope; stageAgain(s); return s; }
function row(value: unknown = recipe, patch: Partial<Snapshot> = {}): Snapshot {
  return { kind:'recipe', recordId:recipe.id, schemaVersion:1, value, deleted:false, people:[], updatedAt:'now', createdAt:'now', updatedBy:scope.owner, deviceId:crypto.randomUUID(), serverVersion:'1', ...patch };
}
function page(changes: Snapshot[] = [], results: Page['results'] = [], hasMore = false): Page {
  return { protocolVersion:1, acceptedOperationIds:results.filter(r=>r.status==='accepted').map(r=>r.operationId), results, conflicts:[], rejected:[], changes, cursor:crypto.randomUUID(), hasMore };
}
function apply(s: Cookbook, response: Page, protectedProgress = false) {
  applyPage(s, exchangeRequest(s), response, () => protectedProgress);
}
function connected(rows: Snapshot[] = [row()]) {
  const s = library(); apply(s, page(rows)); reconcile(s, [], [], () => false); apply(s,page()); return s;
}
function ack(op: Operation, serverVersion: string) {
  return { operationId:op.operationId, status:'accepted' as const, serverVersion };
}
const key = keyOf('recipe',recipe.id);
describe('transactional sync transitions', () => {
  it('stages all pages; bundled and personal content require separate upload decisions', () => {
    const s = library(); s.privateNotes[recipe.id]='personal';
    apply(s,page([],[],true));
    expect(() => reconcile(s,[],[],()=>false)).toThrow('complete');
    apply(s,page()); reconcile(s,[recipe.id],[],()=>false);
    expect(s.recipes).toEqual(sampleRecipes); expect(s.privateNotes[recipe.id]).toBe('personal');
    expect(s.pending.map(p=>p.kind)).toEqual(['recipe']);
    const wire = exchangeRequest(s);
    expect(wire.changes[0]).toMatchObject({type:'put',value:recipe,people:[],baseServerVersion:null});
    expect(wire.changes[0]).not.toHaveProperty('resurrect');
    expect(Object.keys(wire)).toEqual(['protocolVersion','appId','deviceId','spaceId','cursor','limit','changes']);
    expect(exchangeRequest(structuredClone(s))).toEqual(wire);
    s.scope={...scope,spaceId:crypto.randomUUID()}; expect(()=>exchangeRequest(s)).toThrow('different');
  });
  it('links exact matches, stages divergent same-ID copies, and binds local resolution to the server version', () => {
    const s=connected([row({...recipe,name:'Different'})]);
    expect(s.reviews[key].local).toEqual(recipe);
    expect(s.pending).toHaveLength(0); expect(s.recipes[0]).toEqual(recipe);
    resolveReview(s,s.reviews[key],'local');
    expect(exchangeRequest(s).changes[0]).toMatchObject({value:recipe,baseServerVersion:'1'});
    const equal=connected(); expect(equal.pending).toHaveLength(0); expect(equal.reviews).toEqual({});
  });
  it('orders later edits behind immutable operations, retries unchanged, and waits for catch-up beyond an ack', () => {
    const s=connected(); const assoc=[{personId:crypto.randomUUID(),role:'contributor'}]; s.remote[key].people=assoc;
    const edit=(name:string)=>editRecipes(s,s.recipes,s.recipes.map(r=>r.id===recipe.id?{...r,name}:r));
    edit('one'); const first=exchangeRequest(s).changes[0]; edit('two');
    expect(exchangeRequest(s).changes).toEqual([first]); expect(first).toMatchObject({people:assoc});
    apply(s,page([], [ack(first,'2')],true)); expect(s.catchUp).toBe(true);
    const next=exchangeRequest(s).changes[0]; expect(next.baseServerVersion).toBe('2'); expect(next.operationId).not.toBe(first.operationId);
    apply(s,page([row({...recipe,name:'one'},{serverVersion:'2'})],[ack(next,'3')]));
    expect(s.recipes[0].name).toBe('two'); expect(s.catchUp).toBe(true);
    apply(s,page([row({...recipe,name:'two'},{serverVersion:'3'})])); expect(s.catchUp).toBe(false);
  });
  it('finishes the previous page ceiling and downloads an acknowledged continuation write before confirming sync', () => {
    const s=connected();
    const earlier=s.lastSuccess;
    apply(s,page([],[],true));
    editRecipes(s,s.recipes,s.recipes.map(r=>r.id===recipe.id?{...r,name:'Late write'}:r));
    const op=exchangeRequest(s).changes[0];
    apply(s,page([],[ack(op,'2')],true));
    apply(s,page());
    expect(s.catchUp).toBe(true); expect(s.lastSuccess).toBe(earlier);
    expect(s.remote[key].serverVersion).toBe('1');
    expect(s.awaitingSnapshots[key].serverVersion).toBe('2');
    apply(s,page([row({...recipe,name:'Late write'},{serverVersion:'2'})]));
    expect(s.catchUp).toBe(false); expect(s.awaitingSnapshots).toEqual({});
  });
  it('requires review for remote tombstones and explicit resurrection, keeping note versions independent', () => {
    const s=connected([row(),row({note:'Household'}, {kind:'shopping-note',serverVersion:'9'})]);
    s.privateNotes[recipe.id]='Private';
    apply(s,page([row(null,{deleted:true,serverVersion:'4'})]));
    expect(s.recipes[0]).toEqual(recipe);
    resolveReview(s,s.reviews[key],'local');
    expect(exchangeRequest(s).changes[0]).toMatchObject({baseServerVersion:'4',resurrect:true});
    expect(s.privateNotes[recipe.id]).toBe('Private'); expect(s.sharedNotes[recipe.id]).toBe('Household');
    shareNote(s,recipe.id);
    const noteKey=keyOf('shopping-note',recipe.id); expect(s.reviews[noteKey].local).toEqual({note:'Private'});
    resolveReview(s,s.reviews[noteKey],'server');
    editNote(s,recipe.id,'','Household',true);
    const del=exchangeRequest(s).changes.find(op=>op.kind==='shopping-note')!;
    expect(del).toEqual({type:'delete',kind:'shopping-note',recordId:recipe.id,operationId:del.operationId,baseServerVersion:'9'});
  });
  it('preserves conflicts across cursor resets, including queued deletes and absent records', () => {
    const s=connected(); editRecipes(s,s.recipes,s.recipes.filter(r=>r.id!==recipe.id));
    const original=structuredClone(s.pending); stageAgain(s);
    expect(exchangeRequest(s).changes).toEqual([]);
    apply(s,page()); reconcile(s,[],[],()=>false);
    expect(s.pending).toEqual(original); expect(s.reviews[key].local).toBeNull(); expect(exchangeRequest(s).changes).toEqual([]);
  });
  it('keeps unsupported raw snapshots and reviews changes affecting local cooking progress', () => {
    const s=connected(); const future=row({schemaVersion:2,unrecognized:{x:1}},{schemaVersion:2,serverVersion:'2'});
    apply(s,page([future])); expect(s.reviews[key].remote).toEqual(future);
    expect(()=>resolveReview(s,s.reviews[key],'server')).toThrow('Unsupported');
    const other=connected(); apply(other,page([row({...recipe,events:recipe.events.slice(1)},{serverVersion:'2'})]),true);
    expect(other.recipes[0].events).toEqual(recipe.events); expect(other.reviews[key]).toBeDefined();
  });
  it('continues unrelated uploads after oversize and nesting failures measured on actual JSON', () => {
    const s=connected();
    const big={...recipe,id:'big',notes:Array.from({length:16},()=> 'é'.repeat(2500))};
    let nested:unknown='leaf'; for(let depth=0;depth<31;depth++) nested={nested};
    const deep={...recipe,id:'deep',future:nested};
    editRecipes(s,s.recipes,[...s.recipes,big,deep,{...recipe,id:'ok'}]);
    expect(s.reviews['recipe:big'].reason).toContain('64 KiB'); expect(s.reviews['recipe:deep'].reason).toContain('nesting');
    expect(parseRecipeImport(exportRecipes([big]))).toEqual([big]); expect(exchangeRequest(s).changes.map(op=>op.recordId)).toEqual(['ok']);
  });
  it('bounds bytes and count, validates complete acknowledgements and isolates per-operation rejection', () => {
    const s=connected(); const additions=Array.from({length:28},(_,i)=>({...recipe,id:'batch-'+i,notes:Array.from({length:12},()=> 'é'.repeat(1800))}));
    editRecipes(s,s.recipes,[...s.recipes,...additions]);
    const req=exchangeRequest(s); expect(bytes(req)).toBeLessThanOrEqual(1048576); expect(req.changes.length).toBeLessThan(28);
    expect(()=>applyPage(s,req,page(),()=>false)).toThrow('acknowledgements');
    apply(s,page([],req.changes.map((op,i)=>i===0?{operationId:op.operationId,status:'rejected',code:'INVALID_PAYLOAD'}:ack(op,'1'))));
    expect(s.reviews['recipe:batch-0'].reason).toContain('INVALID_PAYLOAD');
    expect(exchangeRequest(s).changes.length).toBeGreaterThan(0);
  });
  it('preserves compatible omitted metadata through an older recipe editor and retains incoming nested order', () => {
    const old = {...recipe, origin:'family', ingredients:recipe.ingredients.map(i=>({...i, vendor:'market'}))};
    const replaced = {...recipe, ingredients:[...recipe.ingredients].reverse()};
    const merged = mergeRecipes([old], [replaced], 'replace').recipes[0];
    expect(merged.origin).toBe('family');
    expect(merged.ingredients).toEqual(replaced.ingredients.map(i=>({...i,vendor:'market'})));
  });
  it('keeps an unuploadable creation locally when its shared counterpart is absent', () => {
    const s=connected();
    const big={...recipe,id:'large',notes:Array.from({length:25},()=> 'é'.repeat(2400))};
    editRecipes(s,s.recipes,[...s.recipes,big]);
    resolveReview(s,s.reviews['recipe:large'],'server');
    expect(s.recipes.at(-1)).toEqual(big);
    expect(s.privateRecipes).toContain(big.id);
    expect(exchangeRequest(s).changes).toEqual([]);
  });
  it('rejects stale imports and stale conflict choices, preserving local drafts and nested metadata', () => {
    const s=connected(); const before=structuredClone(s.recipes);
    const remote={...recipe,name:'New',future:[3,2,1],ingredients:recipe.ingredients.map(i=>({...i,source:'test'}))};
    apply(s,page([row(remote,{serverVersion:'2'})]));
    expect(()=>editRecipes(s,before,[])).toThrow('changed');
    expect(parseRecipeImport(exportRecipes([s.recipes[0]]))[0]).toEqual(remote);
    expect(same({...remote,events:[...remote.events].reverse()},remote)).toBe(false);
    apply(s,page([row(null,{deleted:true,serverVersion:'3'})]));
    const old=s.reviews[key]; apply(s,page([row({...remote,name:'Newer'},{serverVersion:'4'})]));
    expect(()=>resolveReview(s,old,'local')).toThrow('changed');
  });
});
