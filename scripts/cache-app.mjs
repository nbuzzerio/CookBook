import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

const root = 'dist';
async function files(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await files(path));
    else if (entry.name !== 'sw.js') found.push(path);
  }
  return found;
}
const paths = (await files(root)).sort();
const hash = createHash('sha256');
for (const path of paths) hash.update(path).update(await readFile(path));
const cache = 'countertop-static-' + hash.digest('hex').slice(0, 16);
const manifest = paths.map(path => './' + relative(root, path).split(sep).join('/'));
await writeFile(join(root, 'sw.js'), `
const cacheName = ${JSON.stringify(cache)};
const assets = ${JSON.stringify(manifest)};
const scope = self.registration.scope;
const urls = new Set(assets.map(path => new URL(path, scope).href));
self.addEventListener('install', event => event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('countertop-static-') && key !== cacheName) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(scope)) return;
  const path = req.mode === 'navigate' && new URL(req.url).pathname === new URL(scope).pathname ? new URL('index.html', scope).href : req.url;
  if (urls.has(path)) event.respondWith(caches.open(cacheName).then(async cache => await cache.match(path) || fetch(req)));
});
`);
