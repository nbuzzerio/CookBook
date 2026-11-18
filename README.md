# Countertop v0.1

A personal cookbook for the kitchen counter: an editorial recipe library, ingredient checklist, parallel cooking timeline, guided cooking session, and combined shopping list. Everything runs in the browser. No backend, accounts, API keys, analytics, or external data services are required.

## Run locally

Use Node.js 22.12 or newer and pnpm 11.9.0:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local URL printed by Vite, normally `http://127.0.0.1:5173`. On Windows PowerShell, use `pnpm.cmd` if script execution policy prevents `pnpm` from running.

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

The production build serves from `/apps/recipes/`. Open `http://127.0.0.1:4173/apps/recipes/` for a static preview. Recipe links use the hash. Production API requests use the same host under `/api/v1/`.

GitHub Actions validates pull requests and deploys successful pushes to main after one-time server and environment setup. [Deployment, verification and rollback](docs/CI_CD_DEPLOYMENT.md)

For development with a separate **loopback** Personal Sync Service on port 4317, set `COUNTERTOP_LOCAL_PSS=1` before starting Vite and configure that service with the exact Vite origin. The cookbook also works independently of the service.

## Use your cookbook

- **Library:** search titles, descriptions, ingredient names, and tags; filter categories or favorites. Three complete dinner recipes are available on first launch.
- **Recipe:** switch between Overview, Ingredients, Timeline, and Cook. Changing servings scales original numerical ingredient quantities and updates an existing shopping selection. Cooking temperatures and times stay fixed.
- **Ingredients:** gather the meal’s components with large checkboxes and a saved progress count.
- **Timeline:** scan relative start times, named cooking tracks, durations, overlapping activities, temperature targets, and doneness guidance.
- **Cook:** start/pause/resume a session, jump to any step, mark steps complete, and run several independent timers. Timers start explicitly and continue independently if the session clock is paused. Refresh restores session and timer state.
- **Shopping list:** add recipes from their detail pages, adjust servings, collect compatible ingredients by grocery category, check items off, hide purchased items, reset, copy, or print.
- **Personal shopping notes:** in a recipe’s Overview, choose **Add note** near the shopping-list action. Keep a plain-text reminder of up to 500 characters, such as a preferred brand. Notes appear beside their recipes in Shopping List and in copied or printed shopping lists. Edit, remove, or immediately undo removal. Notes stay with the recipe when it leaves the shopping menu or a same-ID recipe is replaced; a confirmed local removal also removes its private reminder. Shared reminders have their own lifecycle. Notes do not change ingredients, quantities, or cooking steps.
- **Dinner timing:** choose **Time this dinner** from the shopping list. Set a serving date and time to align up to 12 recipes into one chronological timeline, with individual start times, overlapping tasks, and temperature guidance. This coordinates estimates; it does not automatically resolve oven or burner conflicts or change cooking times when servings change.
- **Cooking conveniences:** use **Focus mode** for larger instructions and fewer distractions (Escape exits). Opt into **Keep screen awake** on supported browsers and **Enable timer sound** for a brief foreground chime. Both turn off when you leave Cook; sound needs an explicit click each time you return. Add a minute to a running or paused timer; adding time to a finished timer leaves it paused until you resume it.
- **Pick up where you left off:** active sessions appear in the library with step progress and live timer summaries. Resume without losing work.
- **Recipe copies:** print any recipe from Overview, Ingredients, or Timeline with its selected serving quantities, or export that recipe alone as JSON with its original quantities. The printed sheet includes the full cooking timeline and doneness notes.
- **Full cookbook backup:** in Settings & data, download one JSON file with recipes, personal shopping notes, favorites, serving choices, shopping lists/checks, ingredient checks, saved cooking sessions/timers, dinner timing, and appearance. Restore shows a contents preview and requires explicit confirmation before replacing your current cookbook. Active clocks return paused at the saved time. Recipe-only exports remain available. See [`docs/backup-format.md`](docs/backup-format.md).
- **Settings & data:** select light/dark/system appearance, import and export recipes, remove recipes with confirmation, restore missing samples, or reset all Countertop browser data.

## Import recipes

1. Copy [`public/examples/recipe.json`](public/examples/recipe.json) and author your recipe as JSON, giving it a stable unique `id`.
2. Follow the field definitions in [`docs/recipe-format.md`](docs/recipe-format.md). The executable Zod schema and inferred TypeScript types are in [`src/domain/schema.ts`](src/domain/schema.ts). Generated JSON Schemas are in [`public/recipe.schema.json`](public/recipe.schema.json) and [`public/collection.schema.json`](public/collection.schema.json).
3. Open **Settings & data → Import recipes**, then select the JSON file.
4. Review the validated recipes. Choose whether matching IDs should be kept or replaced, then select **Import recipes**.

Files may contain one recipe or a collection with `{ "schemaVersion": 1, "recipes": [...] }`. Imports and the combined exported collection are limited to 2 MB, with up to 500 recipes. Validation errors report the relevant fields and leave the collection unchanged. For duplicate IDs, keeping existing recipes retains the first occurrence; replacement uses the last occurrence. Export downloads the entire current recipe collection in the same format.

Samples are separate data files:

- [`src/data/recipes/mushroom-meatloaf-dinner.json`](src/data/recipes/mushroom-meatloaf-dinner.json)
- [`src/data/recipes/spinach-mushroom-baked-ziti.json`](src/data/recipes/spinach-mushroom-baked-ziti.json)
- [`src/data/recipes/italian-sausage-peppers.json`](src/data/recipes/italian-sausage-peppers.json)

Sample recipes are illustrative original content, not reproductions of a private family recipe. Optional `coverImage` accepts a relative image path or HTTPS image URL. Put local custom images under `public/` before building. Embedded base64 images are rejected. Missing images receive a designed fallback; bundled artwork and fonts are local assets.

## Architecture

| Location | Responsibility |
| --- | --- |
| `src/app` | App shell, hash navigation, shared collection/preferences/selections |
| `src/components` | Reusable visual and interaction components |
| `src/features/library` | Search, category filters, favorites, recipe cards |
| `src/features/recipes` | Overview, serving controls, ingredient gathering, timeline |
| `src/features/cooking` | Guided session, parallel step selection, timer controls |
| `src/features/dinner` | Shared serving-time plan and combined recipe timeline |
| `src/features/shopping` | Grocery aggregation display, checklist, copy, print |
| `src/features/import-export` | Validated import preview, exports, recipe management, preferences |
| `src/domain` | Zod model, pure scaling, aggregation, timeline, timers, import/export logic and tests |
| `src/sync` | IndexedDB library, migration, scope-bound outbox, household transport, reconciliation and settings |
| `src/storage` | Versioned localStorage envelope, safe recovery, persistence hook and tests |
| `src/data/recipes` | Bundled recipe JSON |
| `src/styles` | Responsive editorial styles and theme tokens |
| `public` | Local images, favicon, downloadable complete example |

The app uses Vite, React, strict TypeScript, Tailwind CSS, Lucide, Zod, and Vitest. Domain calculations work independently of React. Text from imported recipes is rendered as text, never interpreted as HTML. There is no recipe editor or server-side application code.

## Persistence and practical limits

- IndexedDB stores recipes, private reminders, shared records, pending operations, raw migration data and recovery copies. The original localStorage collection remains available for recovery. Device preferences and cooking progress use the existing versioned localStorage keys.
- **Sync** opens setup for an unconnected library. Select a shared household Space and review the download. Existing local recipes and reminders each require an explicit upload choice. Once connected, recipe changes and opted-in reminder changes synchronize automatically. Advanced sync settings include account, Space switching, recovery downloads and conflict review.
- **Full cookbook backup** transfers recipes, reminders and device-local progress. A restore pauses sharing for a new preview. **Download recovery copies** also includes queue and version history held in the browser. Recipe-only exports contain authored recipes.
- Timer remaining time is calculated from persisted timestamps, so throttled tab intervals do not accumulate drift. Finished timers show visible alerts. Optional chimes play only for newly finished timers while the cooking view is visible and audio is enabled; they are not replayed after reload or a hidden tab. Device volume and browser audio policy still apply. There are no push notifications or guaranteed alerts when the browser is closed.
- Screen wake lock requires a supporting browser and a secure context (HTTPS or localhost). The app reports whether a lock is active or declined, releases it when Cook is hidden or left, and requests it again when the visible cooking page returns. Browser or battery policies can release it. Focus mode itself does not depend on this API.
- The production service worker caches the static shell and bundled assets for offline reload after its first successful installation. Optional remote cover URLs need a connection; local bundled imagery does not.
- Shopping merges equal normalized ingredient identities only when units and quantity kinds are compatible. Basic unit aliases are supported; universal weight/volume conversions are outside v0.1.
- Scaling changes ingredient quantities only. Cook larger batches according to actual doneness, pan capacity, and the recipe’s notes. Cooking times are approximate.

Automated domain and persistence tests run with `pnpm test`; strict checking and the production build have separate commands above. No lint script is configured.

For browser checks, run the app locally and use `node scripts/browser-smoke.mjs` and `node scripts/browser-edge-cases.mjs`. They launch isolated headless profiles with installed Chrome on Windows or Playwright Chromium on Linux. Set `COUNTERTOP_URL` to test a loopback server or deployment subpath. The smoke suite captures screenshots in ignored `.qa/` and checks 56 view/width combinations (360–1440px). The edge suite checks concurrent timers, changed shopping requirements, safe import rendering, long names, and storage failures.

Run `node scripts/browser-stretch.mjs` for the dinner timing, focus, wake-lock lifecycle, timer-sound, timer-extension, resume-session, print-layout, and individual-export checks. Browser API mocks verify wake-lock and audio lifecycle without changing the host's screen or playing sound; actual device behavior remains subject to browser support.

Run `node scripts/browser-backup.mjs` for full backup export, preview, cancel, restore, timer freezing, validation, and responsive checks.

Run `node scripts/browser-shopping-notes.mjs` for note editing, refresh recovery, copy/print, safe text rendering, long-note responsive layouts, and recipe replacement/removal behavior.

Regenerate JSON Schemas after changing the runtime schema with `node docs/generate-schema.mjs`. Runtime validation also enforces cross-field rules that JSON Schema cannot express; see the format guide. See [`docs/assets.md`](docs/assets.md) for image provenance and font/icon licenses.

After building, run `node scripts/browser-sync.mjs` for the local PSS integration suite. The test uses the compiled sibling service, a temporary SQLite database and isolated Chrome profiles. See the [integration report](docs/PERSONAL_SYNC_INTEGRATION_REPORT.md) for verification and rollout.
