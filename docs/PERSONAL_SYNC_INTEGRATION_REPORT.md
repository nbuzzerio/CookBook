# Countertop personal sync integration

**November 18, 2026.** Countertop automatically exchanges whole recipes and explicitly shared shopping reminders with Personal Sync Service (PSS). A household login grants access to the Space preview. The first upload requires a separate choice. The packaged client exchanged updates in both directions between isolated desktop and phone-sized Chrome profiles using the actual service and a temporary SQLite database.

| Release state | Assessment |
| --- | --- |
| IMPLEMENTED | Yes. The client integration and static release build are present in CookBook. |
| TESTED LOCALLY | Yes. Typecheck, 93 unit tests, production build and six browser suites passed. |
| HUMAN QA PENDING | Yes. The owner still needs to review the experience on a physical PC and phone. |
| READY TO COMMIT | Yes, for owner review and commit. The working tree contains the changes. |
| READY FOR STATIC DEPLOYMENT | The artifact is ready for `/apps/recipes/`. Confirm that the production PSS release includes the recipe validators before publishing the client. |
| READY FOR REAL-DATA SYNC | Pending production backend confirmation, an owner backup and a physical two-device trial with a disposable recipe. |

## Baseline and storage inventory

The starting tree was clean on `main` at `9926d56`. React’s hash router and app shell owned the library. `usePersistentState` read and wrote versioned JSON envelopes in localStorage. Cooking and shopping views persisted their progress independently. The existing import preview handled collision decisions, and the full-backup restore used a localStorage rollback journal.

All names below use the `countertop:v1:` prefix.

| Original key | Stored value | V1 treatment |
| --- | --- | --- |
| `recipes` | Ordered authored recipe documents, or the three samples on first launch | Migrate to IndexedDB and retain the original string. |
| `shopping-notes` | Personal reminder text by recipe ID | Migrate privately and retain the original string. |
| `favorites`, `theme`, `servings` | Favorite IDs, appearance, serving choices | Device-local. |
| `shopping-plan`, `shopping-checklist` | Selected recipes and servings, checked and hidden item keys | Device-local. |
| `ingredients:<id>` | Ingredient checks | Device-local. |
| `session:<id>` | Session clock, selected and completed steps, independent timer clocks | Device-local. Timers are nested in the session. |
| `dinner-timing` | Desired serving timestamp | Device-local. |
| `restore-journal` | Raw rollback entries | Device-local. Coordinated replacements also carry a commit identifier. |

Focus, sound enablement and screen wake lock live in the cooking view for the visit. The new `library-generation` localStorage key identifies a restore or Space switch so a stale tab can detect it before saving progress.

## Transactional library and migration

The `countertop-personal-sync` IndexedDB database contains a `library` store and a `recovery` store. The active library holds recipes, separate private and shared reminders, consent, the device UUID, owner/app/Space binding, raw server snapshots, pending operations, staged pages, review copies, cursors and retry state. A suspended Space has its own entry keyed by owner, app and Space, together with its device-local progress. Theme follows the device.

A read–write transaction loads the latest library before changing it. The approved edit and its queue entry commit together. The interface reports success after commit. Imports check their starting collection for concurrent changes. Writes to the old recipe and note keys have ended. Those keys remain migration originals. The recovery store archives prior copies before collection replacements, reconciliation, restore and conflict resolution.

On first open, the client recovers any older restore journal, captures the raw Countertop namespace and sample collection, and commits that recovery copy first. A second transaction reads it back, checks a JSON round trip against the captured source, decodes it, then reads back the canonical library before completing migration. An interrupted second transaction can restart. An intentionally empty recipe array stays empty. Individually readable recipes and reminders survive a partially invalid collection. The original strings remain available even for malformed JSON or duplicate IDs.

**Recovery path.** Download the full cookbook backup for ordinary restoration. Advanced sync settings also provide **Download recovery copies**, a separate versioned JSON file. It includes the active library, inactive Spaces, raw storage, staged or unsupported records, queues and archived copies. In the migration entry, `entries` holds the exact key/string pairs and `samples` holds the first-launch collection. To recover authored content manually, extract the recipe array from a valid legacy envelope’s `value` or from an archived state, wrap it in a V1 recipe collection and import into an isolated browser first. The browser suite interrupted migration between commits and verified the recovery download against the original raw strings. Treat that download as private household data.

## Shared records and consent

| Service identity | Shared value | Behavior |
| --- | --- | --- |
| `recipes / recipe / <recipeId>` | One complete V1 recipe | Carries ordered components, ingredients and cooking events, stable nested IDs, original quantities, temperatures, doneness, timer hints, notes and image references. |
| `recipes / shopping-note / <recipeId>` | `{"note":"…"}` | Independent revision and consent. Clearing an opted-in note queues a delete. |

Compatible metadata survives parsing, export and sync. A replacement from an older editor retains omitted extra fields on the recipe and matching nested IDs. The incoming arrays determine order. Existing directory Person associations travel with later puts. New records use an empty association list. Contributor names never establish identity.

The owner can share specific existing reminders at onboarding or enable sharing per recipe later. Remote reminders can be read alongside a private reminder. Turning sharing off keeps subsequent edits local and leaves the previously shared copy in the Space. A recipe deletion never cascades into a shared note. Reminders whose recipes are missing remain available in Advanced settings.

## Household access and initial reconciliation

On open, the client requests `GET /api/v1/auth/session`. An existing household cookie on the canonical host works across app paths, including Workout. The form has one password field, clears it on submission and posts to `/api/v1/auth/household-login`. Authentication uses the browser’s cookie, same-origin requests and browser-generated Origin. Authenticated writes include an in-memory CSRF token. Logout and expiry preserve all queues. Household-session notifications contain no credentials.

Setup lists active shared Spaces through the paginated directory endpoint. If none exists, the owner can create the initial Household Space. Its creation ID is stable for the owner across retries and devices. Normal polling also consumes the separate common-directory cursor to check the bound Space. Switching keeps each cookbook, outbox, conflicts and progress with its original scope. Returning to a previously approved Space resumes its queue. A changed owner cannot send the original household’s queued work.

The initial exchange downloads all pages with an empty upload list. The preview identifies exact matches, downloads, divergent IDs and tombstones. Local-only recipes and personal reminders have separate, initially unchecked upload choices. Equal samples link to existing records without uploading. An empty Space leaves the local collection intact. The device can download shared recipes while keeping its own samples private. A restored or invalidated cursor starts another staged download. Previously queued work then requires a decision before replay.

## Automatic sync, conflicts and deletion

`POST /api/v1/apps/recipes/exchange` uses protocol 1, envelope schema 1 and server-issued cursors. An immutable operation is bound to its original device, owner, app and Space. Successor edits to one record wait for its head operation’s acknowledged base version. An interrupted response retries the exact operation ID and content. The client commits ordered results, record versions, downloaded changes and cursor together. If an acknowledgement arrives during an older paginated download, the client finishes that page sequence and starts a fresh pull. It waits for the acknowledged version’s actual snapshot before reporting success.

Confirmed recipe changes and shared-note changes schedule a pass. Open, foreground, reconnect and visible polling at approximately one minute also trigger it. The header’s **Sync** action forces a push/pull check. Web Locks serialize passes across tabs and BroadcastChannel refreshes their local views. Failures retain the queue. Backoff and Retry-After handle transient failures. CSRF failure clears the cached session so a retry can restore it. **Synced** requires completed catch-up, a successful confirmation and no pending work or reviews.

A concurrent edit retains both versions and displays changed top-level fields, full expandable copies and an export. Choosing the local version creates a fresh operation against the current server version. Choosing the shared version installs it locally. A changed comparison invalidates an older resolution. During restore recovery the reviewer can also inspect a previously queued value that differs from the restored one.

A shared recipe tombstone triggers review when a local copy exists. Accepting it removes the recipe while preserving device-local progress and the personal reminder. Restoring the local recipe sends an explicit resurrection against the tombstone version. A normal shared update to a recipe with saved session, ingredient checks or shopping selections also goes to review. Recovery copies preserve the prior recipe and its raw progress. The user can finish cooking with the old version before accepting a change. Local removal has its own confirmation describing cleanup.

Requests are limited to 32 operations and 1 MiB of actual serialized UTF-8 JSON. A put payload over 65,536 UTF-8 bytes or beyond the request nesting limit stays complete on the device with a review message and export. Other valid records continue. Unsupported incoming snapshots are retained raw and never installed into the cooking view without successful validation.

## Imports, backups and rollback

The existing collection format retains its 500-recipe and 2 MiB limits. One approved import transaction handles every selected addition or replacement. Recipe exports use authored quantities. The portable full backup remains format `countertop-backup`, version 1, with a 4 MiB limit and the existing linked device-state fields.

A confirmed full restore or reset archives the previous cookbook and enters staged reconciliation for a connected Space. Restored notes are private. Missing server recipes never generate automatic deletes. A localStorage rollback journal coordinates the device-local write with the IndexedDB commit identifier. Startup rolls back an unfinished replacement or finalizes an already committed one. Restored timers return paused at backup time. The same coordination protects Space switches. Close other Countertop tabs during a full restore, as the existing restore preview requests.

The portable backup normalizes stale links to its included recipes. For orphaned reminders, unsupported server data, other Spaces, archived progress and outstanding uploads, save the separate recovery download as well. Raw recovery files are available for inspection and manual extraction. They have no one-click restore that would replay a device identity or queue.

## Static release and deployment

The recommended canonical location is **https://www.nickbuzzerio.com/apps/recipes/**. Workout uses `/apps/workout/`, and its configuration follows `/apps/<id>/`. Countertop’s registered service ID is `recipes`. Vite’s production and preview base use the proposed path. Hash links support refresh and deep links. The production service worker caches the versioned static shell, bundled covers, fonts, icons and examples. API responses stay outside its scope. Custom HTTPS cover URLs depend on their external host.

1. Confirm the production PSS release includes the application-specific recipe and shopping-note validators. The backend handoff says its existing schema is sufficient.
2. Back up the current cookbook from the browser and origin that hold it. Browser storage is origin-specific. For a move from localhost or a different host, carry the portable full backup to the canonical site.
3. Build with `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test` and `pnpm build`. Serve the contents of `dist/` under `/apps/recipes/` on the existing canonical HTTPS host. Keep the existing same-origin `/api/v1/` service and cookie settings.
4. Verify the release with a disposable recipe and two physical devices before authorizing the real collection. For rollback, retain the current static release and each device’s backup and recovery download. Close tabs before changing the served release so the service worker can transition. An older localStorage-only client sees its original migration-era library. Export newer authored changes before reverting and pause client activity before any backend rollback.

## Files changed

| Area | Files |
| --- | --- |
| New client | `src/sync/protocol.ts`, `api.ts`, `model.ts`, `store.ts`, `engine.ts`, `SyncSettings.tsx`, `sync.css` |
| App integration | `src/main.tsx`, `src/app/App.tsx`, `src/features/import-export/DataSettings.tsx`, `FullBackup.tsx`, `src/features/recipes/RecipeDetail.tsx`, `ShoppingNote.tsx` |
| Domain and durability | `src/domain/schema.ts`, `importExport.ts`, `src/storage/backup.ts`, `RestoreRecovery.tsx`, `usePersistentState.ts` |
| Static output | `vite.config.ts`, `package.json`, new `scripts/cache-app.mjs`, regenerated `public/recipe.schema.json` and `public/collection.schema.json` |
| Verification | New `src/sync/model.test.ts`, `scripts/browser-sync.mjs`, `scripts/browser-storage.mjs`. Updated `src/storage/backup.test.ts` and the smoke, backup and shopping-note browser scripts for asynchronous IndexedDB startup and persistence |
| Documentation | `README.md`, `docs/recipe-format.md`, `docs/backup-format.md` and this report |

## Tests executed

| Command or suite | Local result |
| --- | --- |
| `pnpm.cmd typecheck`, `pnpm.cmd test`, `pnpm.cmd build` | Passed. 93 tests across 11 files. Production output includes the service worker. |
| `node scripts/browser-smoke.mjs` | Passed. Core cooking and library workflows, corruption recovery, offline interactions and 56 responsive checks. |
| `node scripts/browser-edge-cases.mjs` | Passed. Independent timers, expiry, removal, storage failures, long imports and layout. |
| `node scripts/browser-backup.mjs` | Passed. V1 transfer, confirmation, frozen timers, invalid files, persistent write failures, interrupted journals, recovery and narrow layouts. |
| `node scripts/browser-shopping-notes.mjs` | Passed. Editing, undo, copy/print, privacy-related export behavior, replacement, removal and corrupt inputs. |
| `node scripts/browser-stretch.mjs` | Passed. Focus, wake lock, sound, timer extension, resume, printing, dinner coordination and themes. |
| `node scripts/browser-sync.mjs` | Passed against the packaged client and compiled PSS on loopback. Includes migration interruption and repeat-open, real password login and cookie reuse, CSRF rejection, expiry, wrong password, upload consent, independent notes, offline reload, atomic save failure, lost response, 429/503 recovery, concurrent conflicts, deletion, resurrection, pagination, multiple tabs, app/Space isolation, queued Space switching, oversize retention, restore and cursor invalidation. |

The legacy suites used isolated Chrome profiles and a local Vite server. The sync suite starts the read-only sibling service implementation in its test process with a temporary SQLite file, synthetic owner and ephemeral loopback origin. It serves the built artifact at the production subpath and checks downloaded content, versions, queues, asset loading and 360/390-pixel layouts. The fixture deliberately injects local commit failures, HTTP failures and a lost response. Successful writes and conflict decisions use the real service. Unit coverage includes malformed acknowledgements, operation rejection, depth/byte limits, missing records, future metadata, optional People associations and both sides of the restore commit boundary, and an acknowledged operation beyond an older page ceiling.

Early runs exposed a 360-pixel header overflow and a missing restore confirmation after remount. Both were fixed and the affected suites reran successfully. Vite reports dependency annotation warnings and a main bundle above its default 500 kB advisory threshold. All requested automated suites ran. Physical mobile browsers, production cookie/proxy configuration and the deployed PSS version remain unverified. The work stayed inside CookBook, with no commit, push or deployment.

## Owner experience review

- [ ] Export the existing full cookbook. Save a recovery download after migration and verify that familiar recipes, reminders and an active timer are present.
- [ ] On the physical PC and phone, open the canonical site, restore the household session and select the same active shared Space. Check that Advanced settings remain collapsed during ordinary cooking.
- [ ] Share one disposable recipe and one chosen reminder. Keep another reminder private. Confirm the receiving device shows the expected records.
- [ ] Edit the disposable recipe offline, reopen it, reconnect and verify the other device catches up. Check that favorites, ingredient checks and timers remain independent.
- [ ] Review a conflicting edit and a recipe deletion. Export both copies, try explicit resurrection and verify that cooking progress survives.
- [ ] Confirm the production backend release and backup before consenting to upload the real collection.

**Executive summary.** Recipes synchronize automatically after setup. Desktop and phone-sized clients exchanged updates both ways against local PSS. Personal reminders require opt-in, and cooking sessions and timers stay on their device. Migration preserves legacy data and a raw recovery copy. The static build is ready for the proposed path. Production backend confirmation and the owner’s physical-device trial remain.
