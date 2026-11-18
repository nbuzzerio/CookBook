export async function readLibrary(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('countertop-personal-sync');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const r = db.transaction('library').objectStore('library').get('current');
      r.onsuccess = () => { db.close(); resolve(r.result); };
      r.onerror = () => reject(r.error);
    };
  }));
}

// Only used in a disposable browser context to establish a pre-restore cookbook.
export async function setRestoreFixture(page, other) {
  await page.evaluate(recipe => new Promise((resolve, reject) => {
    const open = indexedDB.open('countertop-personal-sync');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('library', 'readwrite');
      const store = tx.objectStore('library');
      const r = store.get('current');
      r.onsuccess = () => store.put({ ...r.result, revision: r.result.revision + 1, recipes: [{ ...recipe, name: 'My changed collection' }], privateNotes: { [recipe.id]: 'This will be replaced.' } }, 'current');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), other);
}
