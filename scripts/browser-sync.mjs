import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve as path, join } from 'node:path';
import { createRequire } from 'node:module';
import { chromium, expect } from '@playwright/test';
import { readLibrary } from './browser-storage.mjs';
import { openDatabase, migrate } from '../../personal-sync-service/dist/src/db/database.js';
import { bootstrapOwner } from '../../personal-sync-service/dist/src/auth/auth.js';
import { createApp } from '../../personal-sync-service/dist/src/http/app.js';
import { createSpace } from '../../personal-sync-service/dist/src/domain/directory.js';
import { exchange } from '../../personal-sync-service/dist/src/sync/exchange.js';
import { configFromEnv } from '../../personal-sync-service/dist/src/config.js';

const express = createRequire(new URL('../../personal-sync-service/package.json', import.meta.url))('express');
const folder = await mkdtemp(join(tmpdir(), 'countertop-fixture-'));
const db = openDatabase(join(folder, 'synthetic.sqlite'));
const password = randomUUID();
let browser;
let server;
try {
  migrate(db);
  const owner = await bootstrapOwner(db, 'fixture', password);
  const family = randomUUID();
  createSpace(db, owner, { id: family, kind: 'shared', name: 'Family test kitchen' });
  createSpace(db, owner, { id: randomUUID(), kind: 'personal', name: 'Workout only' });
  const app = express();
  const exchanges = [];
  let loseNextWrite = false;
  let loseId;
  const transient = [];
  const failuresAt = [];
  app.use('/apps/recipes', express.static(path('dist')));
  app.use((req, res, next) => {
    if (req.path.endsWith('/exchange') && transient.length) {
      const status = transient.shift();
      failuresAt.push(Date.now());
      if (status === 429) res.setHeader('Retry-After','2');
      return res.status(status).json({error:{code:status===429?'RATE_LIMITED':'STORAGE_UNAVAILABLE'}});
    }
    if (req.path.endsWith('/exchange')) {
      const produce = res.json.bind(res);
      res.json = result => {
        exchanges.push({ request: req.body, result, status: res.statusCode });
        if (loseNextWrite && req.body.changes?.length && result.acceptedOperationIds?.length) {
          loseNextWrite = false; loseId = req.body.changes[0].operationId; res.socket.destroy(); return res;
        }
        return produce(result);
      };
    }
    next();
  });
  server = createServer(app);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  app.use(createApp(db, configFromEnv({ NODE_ENV: 'test', PUBLIC_ORIGIN: origin, DATABASE_PATH: join(folder, 'synthetic.sqlite') }), () => {}));
  const base = origin + '/apps/recipes/';
  const recipe = JSON.parse(await readFile('src/data/recipes/spinach-mushroom-baked-ziti.json', 'utf8'));
  const local = { ...structuredClone(recipe), id: 'family-lasagna', name: 'Family lasagna', futureMetadata: { edition: 2 } };
  local.ingredients[0].marketHint = 'Saturday';
  browser = await chromium.launch({ channel: 'chrome' });
  const errors = [];
  async function device(width, seed) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: width < 500 ? 'dark' : 'light' });
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    if (seed) await context.addInitScript(({ local, recipe }) => {
      if (localStorage.getItem('fixture-seeded')) return;
      const save = (k,v) => localStorage.setItem('countertop:v1:' + k, JSON.stringify({version:1,value:v}));
      save('recipes', [recipe, local]); save('shopping-notes', { [local.id]: 'Private brand', [recipe.id]: 'Choose local cheese' });
      save('favorites', [local.id]); save('ingredients:' + local.id, [local.ingredients[0].id]);
      const timed = local.events.find(e => e.timerMinutes);
      const start = Date.now();
      save('session:'+local.id, {status:'running',accumulatedMs:0,startedAt:start,selectedId:timed.id,completedIds:[],timers:{[timed.id]:{durationMs:600000,remainingMs:600000,startedAt:start,status:'running'}}});
      localStorage.setItem('fixture-seeded','yes');
    }, { local, recipe });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '#/settings');
    await expect(page.getByRole('button', {name:'Sync',exact:true})).toHaveCount(1);
    await expect(page.locator('#advanced-sync')).not.toHaveAttribute('open','');
    await page.getByText('Advanced sync settings', {exact:true}).click();
    return { page, context };
  }
  // Abort the first migration after its recovery copy has committed.
  const interrupted = await browser.newContext();
  await interrupted.addInitScript(({ local, recipe }) => {
    if (sessionStorage.getItem('fixture-interrupted')) return;
    const prefix = 'countertop:v1:';
    localStorage.setItem(prefix+'recipes', JSON.stringify({version:1,value:[local]}));
    localStorage.setItem(prefix+'shopping-notes', JSON.stringify({version:1,value:{[local.id]:'Keep this reminder',[recipe.id]:42}}));
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value, key) {
      if (this.name === 'library' && key === 'current') {
        sessionStorage.setItem('fixture-interrupted','yes');
        this.transaction.abort();
        throw new Error('Injected migration interruption');
      }
      return add.call(this,value,key);
    };
  }, { local, recipe });
  const recovered = await interrupted.newPage(); await recovered.goto(base);
  await expect(recovered.getByRole('heading',{name:'Your saved cookbook could not open.'})).toBeVisible();
  assert.equal(await readLibrary(recovered),undefined);
  await recovered.reload();
  await expect(recovered.locator('.recipe-card')).toHaveCount(1);
  const firstMigration = await readLibrary(recovered);
  assert.deepEqual(firstMigration.recipes,[local]);
  assert.equal(firstMigration.privateNotes[local.id],'Keep this reminder');
  assert.match(firstMigration.migrationWarning,/shopping notes/);
  const corruptRaw = await recovered.evaluate(()=>localStorage.getItem('countertop:v1:shopping-notes'));
  await recovered.reload(); await expect(recovered.locator('.recipe-card')).toHaveCount(1);
  assert.equal((await readLibrary(recovered)).device,firstMigration.device);
  await recovered.goto(base+'#/settings/sync');
  const recoveryFile=recovered.waitForEvent('download'); await recovered.getByRole('button',{name:'Download recovery copies'}).click();
  const recovery=JSON.parse(await readFile(await (await recoveryFile).path(),'utf8'));
  assert.equal(recovery.copies.filter(c=>c.format==='countertop-migration').length,1);
  assert.equal(Object.fromEntries(recovery.copies[0].entries)['countertop:v1:shopping-notes'],corruptRaw);
  assert.deepEqual(JSON.parse(Object.fromEntries(recovery.copies[0].entries)['countertop:v1:recipes']).value,[local]);
  await interrupted.close();

  const pc = await device(1280, true);
  const phone = await device(360, false);
  const button = (p,name) => p.getByRole('button',{ name,exact:true });
  async function signIn(p) {
    await p.getByLabel('Household password').fill(password);
    await button(p,'Sign in').click();
    await expect(button(p,'Sign out')).toBeVisible();
  }
  async function preview(p) {
    await button(p,'Preview shared cookbook').click();
    await expect(p.getByRole('heading',{name:'Review this Space'})).toBeVisible();
  }
  const records = () => db.prepare("SELECT kind,id,payload,revision,deleted FROM records WHERE app_id='recipes' AND space_id=?").all(family);
  const record = (kind,id) => records().find(r=>r.kind===kind && r.id===id);
  async function idle(p) {
    await expect.poll(async () => {
      const s = await readLibrary(p);
      return [s.phase, s.catchUp, s.pending.length, Object.values(s.reviews).map(r => r.reason), s.issue, s.lastSuccess > 0];
    },{timeout:15000}).toEqual(['ready',false,0,[],'',true]);
  }
  async function manual(p) {
    const response = p.waitForResponse(r => r.url().endsWith('/exchange'));
    await button(p,'Sync').click(); await response;
  }
  async function importRecipes(p, recipes) {
    await p.goto(base+'#/settings');
    await p.getByLabel('Import recipe JSON file').setInputFiles({name:'family.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schemaVersion:1,recipes}))});
    const preview = p.getByRole('region',{name:'Review recipe import'});
    await expect(preview).toBeVisible();
    const replace = preview.locator('input[value=replace]');
    if (await replace.count()) await replace.check();
    await preview.getByRole('button',{name:'Import recipes'}).click();
    await expect(preview).toHaveCount(0);
  }
  const connected = async p => { await button(p,'Apply choices and connect').click(); await idle(p); };
  await signIn(pc.page);
  assert.equal(records().length,0);
  await preview(pc.page);
  assert.equal(await pc.page.getByLabel('Shared Space',{exact:true}).count(),0);
  await pc.page.getByRole('group',{name:'Upload selected local recipes'}).getByLabel(local.name).check();
  await pc.page.getByRole('group',{name:'Upload selected local recipes'}).getByLabel(recipe.name).check();
  await pc.page.getByRole('group',{name:'Share selected personal reminders'}).getByLabel(/Choose local cheese/).check();
  assert.equal(records().length,0);
  await connected(pc.page);
  assert.equal(records().length,3);
  assert.deepEqual(JSON.parse(record('recipe',local.id).payload),local);
  assert.ok(!record('shopping-note',local.id));
  const sessionBefore = await pc.page.evaluate(id => localStorage.getItem('countertop:v1:session:'+id),local.id);
  assert.ok(sessionBefore);

  // An existing household cookie obtained from the Workout path restores without another form.
  const login = await phone.context.request.post(origin+'/api/v1/auth/household-login',{data:{password},headers:{Origin:origin,Referer:origin+'/apps/workout/'}});
  assert.equal(login.status(),200);
  const noCsrf = await phone.context.request.post(origin+'/api/v1/apps/recipes/exchange',{data:{},headers:{Origin:origin}});
  assert.equal(noCsrf.status(),403);
  await phone.page.reload();
  await phone.page.getByText('Advanced sync settings',{exact:true}).click();
  await expect(button(phone.page,'Sign out')).toBeVisible();
  await expect(phone.page.getByLabel('Household password')).toHaveCount(0);
  assert.equal(await phone.page.locator('select option').filter({hasText:'Workout only'}).count(),0);
  await preview(phone.page);
  await expect(phone.page.locator('#advanced-sync li').filter({hasText:recipe.id}).first()).toContainText('Exact match');
  const writesBeforePhone = records().map(r=>r.revision);
  await connected(phone.page);
  assert.deepEqual(records().map(r=>r.revision),writesBeforePhone);
  assert.deepEqual((await readLibrary(phone.page)).recipes.find(r=>r.id===local.id),local);
  assert.equal((await readLibrary(phone.page)).sharedNotes[recipe.id],'Choose local cheese');
  assert.equal((await readLibrary(phone.page)).privateNotes[local.id],undefined);
  assert.equal(await phone.page.evaluate(()=>localStorage.getItem('countertop:v1:favorites')),null);

  // Offline reload exercises the packaged shell and the canonical database.
  await phone.page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(()=>phone.page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await phone.context.setOffline(true);
  const edited = { ...local, name:'Phone variation' };
  await importRecipes(phone.page,[edited]);
  const pendingId = (await readLibrary(phone.page)).pending[0].id;
  await phone.page.reload();
  await expect(phone.page.locator('.data-imported-list')).toContainText(edited.name);
  assert.equal((await readLibrary(phone.page)).pending[0].id,pendingId);
  loseNextWrite = true;
  await phone.context.setOffline(false);
  await idle(phone.page);
  assert.equal(loseId,pendingId);
  assert.ok(exchanges.filter(e=>e.request?.changes?.some(c=>c.operationId===pendingId)).length>=2);
  assert.equal(record('recipe',local.id).revision,2);
  await manual(pc.page);
  const comparisons = pc.page.locator('.sync-comparison');
  await expect(comparisons.first()).toContainText('Review before replacing');
  await button(pc.page,'Use shared version on this device').click();
  await idle(pc.page);
  assert.equal((await readLibrary(pc.page)).recipes.find(r=>r.id===local.id).name,edited.name);
  assert.ok(await pc.page.evaluate(id=>localStorage.getItem('countertop:v1:ingredients:'+id),local.id));

  assert.equal(await pc.page.evaluate(id => localStorage.getItem('countertop:v1:session:'+id),local.id),sessionBefore);
  assert.ok(exchanges.every(e=>!(e.request?.changes??[]).some(op=>!['recipe','shopping-note'].includes(op.kind))));
  // Simultaneous offline edits must expose both copies and allocate a new resolution operation.
  await phone.context.setOffline(true);
  await importRecipes(phone.page,[{ ...edited, name:'Phone choice' }]);
  await importRecipes(pc.page,[{ ...edited, name:'PC choice' }]); await idle(pc.page);
  assert.equal((await readLibrary(phone.page)).pending.length,1);
  assert.equal(JSON.parse(record('recipe',local.id).payload).name,'PC choice');
  await phone.context.setOffline(false);
  await expect.poll(async()=>Object.keys((await readLibrary(phone.page)).reviews).length).toBe(1);
  await phone.page.goto(base+'#/settings/sync');
  await expect(phone.page.locator('.sync-comparison')).toContainText('Both devices');
  const comparison = phone.page.locator('.sync-comparison');
  for (const title of ['This device','Shared Space']) await comparison.locator('summary').filter({hasText:title}).click();
  await expect(comparison.locator('pre').first()).toContainText('Phone choice');
  await expect(comparison.locator('pre').last()).toContainText('PC choice');
  assert.equal(await comparison.evaluate(node => node.scrollWidth > node.clientWidth),false);
  await mkdir('.qa/sync',{recursive:true});
  await comparison.screenshot({path:'.qa/sync/conflict-phone.png'});
  await button(phone.page,'Use local version in Space').click();
  await idle(phone.page);
  assert.equal(JSON.parse(record('recipe',local.id).payload).name,'Phone choice');

  // Clear one shared note independently and explicitly resurrect its deleted recipe.
  await pc.page.goto(base+'#/recipe/'+recipe.id+'/overview');
  await button(pc.page,'Remove note').click();
  await expect.poll(()=>record('shopping-note',recipe.id)?.deleted).toBe(1);
  assert.equal(record('recipe',recipe.id).revision,1);
  await phone.page.goto(base+'#/settings');
  phone.page.once('dialog',d=>d.accept());
  await button(phone.page,'Remove '+recipe.name).click();
  await expect.poll(()=>record('recipe',recipe.id)?.deleted).toBe(1);
  await pc.page.goto(base+'#/settings/sync');
  await manual(pc.page);
  const deletedRecipe = pc.page.locator('.sync-comparison').filter({hasText:recipe.id});
  await deletedRecipe.getByRole('button',{name:'Restore local copy to Space'}).click();
  await expect.poll(()=>record('recipe',recipe.id)?.deleted).toBe(0);
  assert.ok(exchanges.some(e=>e.request?.changes?.some(op=>op.recordId===recipe.id && op.resurrect===true && op.baseServerVersion==='2')));
  assert.equal(record('shopping-note',recipe.id).deleted,1);
  assert.equal((await readLibrary(pc.page)).privateNotes[local.id],'Private brand');

  // Seed independent streams in the disposable service with the exact same ID.
  const otherSpace = randomUUID();
  createSpace(db,owner,{id:otherSpace,name:'Separate fixture',kind:'shared'});
  function external(appId,spaceId,kind,value) {
    const result=exchange(db,owner,appId,{protocolVersion:1,appId,spaceId,deviceId:randomUUID(),cursor:null,changes:[
      {operationId:randomUUID(),baseServerVersion:null,type:'put',recordId:local.id,kind,schemaVersion:1,value,people:[]}
    ]});
    assert.equal(result.results[0].status,'accepted');
  }
  external('recipes',otherSpace,'recipe',{...local,name:'Separate recipe'});
  external('family-calendar',family,'label',{id:local.id,name:'Separate category',kind:'Category',color:'#336699'});
  await manual(phone.page);
  assert.equal((await readLibrary(phone.page)).recipes.find(r=>r.id===local.id).name,'Phone choice');

  // A failed IDB commit must leave both the cookbook and its outbox unchanged.
  const atomic = {...recipe,id:'atomic-fixture',name:'Atomic save'};
  await phone.page.goto(base+'#/settings');
  await phone.page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value,key) {
      if (this.name === 'library' && key === 'current' && value.recipes.some(r=>r.id==='atomic-fixture')) {
        IDBObjectStore.prototype.put = put;
        this.transaction.abort();
        throw new Error('Injected local commit failure');
      }
      return put.call(this,value,key);
    };
  });
  await phone.page.getByLabel('Import recipe JSON file').setInputFiles({name:'atomic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(atomic))});
  const retryImport = phone.page.getByRole('region',{name:'Review recipe import'}).getByRole('button',{name:'Import recipes'});
  await retryImport.click();
  await expect(phone.page.getByRole('alert').filter({hasText:'Injected local commit failure'})).toBeVisible();
  const state=await readLibrary(phone.page);
  assert.ok(!state.recipes.some(r=>r.id===atomic.id) && !state.pending.some(p=>p.recordId===atomic.id));
  transient.push(429,503);
  await retryImport.click();
  await expect.poll(()=>record('recipe',atomic.id)?.revision,{timeout:15000}).toBe(1);
  assert.ok(failuresAt[1]-failuresAt[0]>=1900);
  await idle(phone.page);

  // A second same-origin tab shares the outbox and the cross-tab lock.
  const tab = await phone.context.newPage(); await tab.goto(base+'#/settings');
  const many = Array.from({length:35},(_,i)=>({...recipe,id:'fixture-'+i,name:'Fixture '+i}));
  await importRecipes(tab,many);
  await Promise.all([manual(phone.page),manual(tab)]);
  await idle(tab);
  assert.ok(exchanges.some(e=>e.result.hasMore));
  assert.equal(record('recipe','fixture-34').revision,1);
  assert.ok(exchanges.filter(e=>e.status===200).every(e=> (e.request.appId==='recipes' && e.request.spaceId===family && e.request.changes.length<=32 && Buffer.byteLength(JSON.stringify(e.request))<=1048576)));
  await tab.close();
  for (const width of [360,390,1280]) {
    await phone.page.setViewportSize({width,height:900});
    assert.equal(await phone.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  assert.equal(await phone.page.locator('link[rel=icon]').evaluate(link => link.href),base+'favicon.svg');
  await phone.page.goto(base+'#/recipe/'+local.id+'/overview');
  await expect(phone.page.locator('.recipe-cover img').first()).toBeVisible();
  assert.ok(await phone.page.locator('.recipe-cover img').first().evaluate(img=>img.complete && img.naturalWidth>0));
  const big = {...recipe,id:'big-fixture',notes:Array.from({length:25},()=> 'é'.repeat(2000))};
  await importRecipes(phone.page,[big,{...recipe,id:'small-fixture'}]);
  await expect.poll(()=>record('recipe','small-fixture')?.revision).toBe(1);
  const bigState=await readLibrary(phone.page);
  assert.deepEqual(bigState.recipes.find(r=>r.id===big.id),big);
  assert.match(bigState.reviews['recipe:'+big.id].reason,/64 KiB/);
  assert.ok(!record('recipe',big.id));

  // A restore pauses all outgoing traffic until the preview is accepted.
  const backup = phone.page.waitForEvent('download'); await button(phone.page,'Download full backup').click();
  const raw = JSON.parse(await readFile(await (await backup).path(),'utf8'));
  raw.state.recipes=[recipe]; raw.state.shoppingNotes={[recipe.id]:'Restored private text'};
  await phone.page.getByLabel('Restore full cookbook backup file').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});
  await phone.page.getByLabel('Replace my current cookbook and progress').check();
  const previous=records(); await button(phone.page,'Restore this backup').click();
  await expect.poll(async()=>(await readLibrary(phone.page)).phase).toBe('preview');
  assert.deepEqual(records(),previous);
  assert.equal((await readLibrary(phone.page)).privateNotes[recipe.id],'Restored private text');
  assert.ok((await readLibrary(phone.page)).pending.some(p=>p.recordId===big.id));

  // Switch away with pending work and return. Neither the queued record nor the personal note travels.
  const frozenQueue = (await readLibrary(phone.page)).pending;
  await phone.page.goto(base+'#/settings/sync'); await phone.page.reload();
  async function switchTo(id) {
    const details = phone.page.locator('#advanced-sync details').filter({has:phone.page.getByText('Change Space',{exact:true})}).first();
    await details.locator('summary').first().click();
    await details.getByLabel('Destination Space').selectOption(id);
    await button(phone.page,'Switch cookbook Space').click();
    await expect.poll(async()=>(await readLibrary(phone.page)).scope.spaceId).toBe(id);
  }
  await switchTo(otherSpace);
  await connected(phone.page);
  const alternate = await readLibrary(phone.page);
  assert.equal(alternate.recipes.find(r=>r.id===local.id).name,'Separate recipe');
  assert.equal(alternate.privateNotes[recipe.id],undefined);
  assert.equal(alternate.pending.length,0);
  await switchTo(family);
  const returned = await readLibrary(phone.page);
  assert.deepEqual(returned.pending,frozenQueue);
  assert.equal(returned.privateNotes[recipe.id],'Restored private text');
  assert.ok(!db.prepare("SELECT 1 FROM records WHERE space_id=? AND id=?").get(otherSpace,big.id));

  // Invalidate the disposable service's cursor signing key, as after a service recovery.
  db.prepare("UPDATE service_meta SET value=? WHERE key='cursor_key'").run(randomUUID());
  await manual(pc.page);
  await expect.poll(async()=>(await readLibrary(pc.page)).phase).toBe('preview');
  assert.deepEqual(records(),previous);
  await pc.page.goto(base+'#/settings/sync');
  await expect(button(pc.page,'Apply choices and connect')).toBeVisible();
  assert.ok(exchanges.some(e=>e.status===409 && e.result.error?.code==='CURSOR_RESET_REQUIRED'));
  // Sessions are revoked only in this disposable SQLite fixture.
  db.prepare('DELETE FROM sessions').run();
  await button(pc.page,'Sync').click();
  await expect(pc.page.getByLabel('Household password')).toBeVisible();
  assert.ok((await readLibrary(pc.page)).recipes.length);
  await pc.page.getByLabel('Household password').fill(password+'incorrect');
  await button(pc.page,'Sign in').click();
  await expect(pc.page.getByRole('alert')).toContainText('Incorrect household password');
  assert.equal(await pc.page.getByLabel('Household password').inputValue(),'');
  assert.ok(!(JSON.stringify(await readLibrary(pc.page))).includes(password));
  assert.deepEqual(errors,[]);
  console.log('PASS: packaged site, household auth/cookie reuse/CSRF/expiry, scoped consent, two devices, metadata, offline restart, lost response, conflict resolution, pagination, multi-tab, oversized records, restore pause, cursor reset, responsive assets.');
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(done=>server.close(done)); }
  db.close();
  await rm(folder,{recursive:true,force:true});
}
