# Full cookbook backups

Use **Settings & data → Full cookbook backup → Download full backup** to keep the entire cookbook in one local JSON file. To restore, choose that file, review its date and contents, check **Replace my current cookbook and progress**, and select **Restore this backup**. Download the current cookbook first if you want to keep it. Close other Countertop tabs before restoring.

A restore replaces all Countertop data in this browser; it does not merge collections. It leaves other applications' localStorage keys alone. A connected library pauses outgoing writes after restore and presents a new Space comparison. Restored shopping notes start private.

## What is included

- Recipes and original ingredient quantities
- Favorites and appearance preference
- Serving choices and selected shopping recipes
- Personal shopping notes
- Shopping item completion and hidden purchased items
- Per-recipe ingredient checks
- Saved cooking sessions, completed steps, selected step, and independent timers
- Dinner serving date and time

Images are referenced by path or URL, not embedded. Bundle custom local images with the deployed app when moving to another device. Temporary UI state, such as search terms, unsaved note drafts, focus mode, sound permission, and screen wake lock, is not backed up. Progress is read from saved browser storage; changes that failed to save may be missing. Unreadable saved progress stops a full export with a useful error; recipe-only export is still available.

## Version 1 structure

The executable schema and inferred TypeScript types are in [`src/domain/backup.ts`](../src/domain/backup.ts). Full backups use a different format from recipe imports:

```json
{
  "format": "countertop-backup",
  "version": 1,
  "createdAt": "2026-11-06T12:00:00.000Z",
  "state": {
    "recipes": [],
    "favorites": [],
    "theme": "system",
    "shoppingPlan": [],
    "servings": {},
    "shoppingNotes": {},
    "ingredientChecks": {},
    "sessions": {},
    "shoppingChecklist": { "checked": [], "hidden": [] },
    "dinnerTiming": null
  }
}
```

This is a valid empty cookbook backup. Download a full backup from the app for a complete example with your recipes and progress. All fields are required. The file limit is 4 MB; the recipe collection within it retains its 2 MB and 500-recipe limits. Unsupported versions, malformed values, duplicate IDs, orphan references, embedded images, and unknown backup envelope fields are rejected before storage changes. Compatible recipe metadata is retained.

`favorites` contains recipe IDs. `shoppingPlan` contains `{ "recipeId": "...", "servings": 4 }` entries. `servings`, `shoppingNotes`, `ingredientChecks`, and `sessions` are keyed by recipe ID. Ingredient checks contain ingredient IDs, and session step/timer references must match that recipe. Shopping completion keys describe the exact ingredient identities, units, and quantities; use app-generated values. `dinnerTiming`, if present, is `{ "serveAt": 1793966400000 }` with an absolute Unix timestamp in milliseconds.

## Clocks and restore recovery

Export preserves live clock timestamps. Restoring converts running sessions and timers to a paused snapshot at `createdAt`, so an old backup never starts timers or counts months of elapsed time. Timers that had already elapsed at the backup time are restored as finished. Paused and idle clocks retain their state. Dinner timing keeps its original absolute time and may be in the past; adjust it before cooking again.

Restore stores a temporary rollback journal in localStorage before changing application keys. If browser storage fills up during the write, the app attempts to restore every original value. If the tab closes or storage access interrupts that rollback, the journal is recovered before the app loads on the next visit. Recovery that cannot finish blocks normal editing and offers retry, a download of raw recovery data for manual repair, or a confirmed reset. A restore can require extra temporary storage for this safety copy; it reports when there is not enough room. The journal is removed after success or successful rollback.

Recipe-only JSON remains the format for importing or sharing individual recipes and recipe collections. Personal annotations and progress are included only in full backups.

The portable V1 file represents the active cookbook and valid linked progress. Advanced sync settings also offer a versioned recovery download containing raw local storage, archived copies, inactive Spaces, queued operations and raw shared snapshots. It is intended for manual recovery. Keep it private.
