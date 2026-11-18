# Countertop recipe JSON · version 1

Recipes are authored as JSON, then imported through **Settings / Data → Import JSON**. The runtime schema and TypeScript types share one source of truth: [`src/domain/schema.ts`](../src/domain/schema.ts), using Zod and `z.infer`. There is no recipe editor.

Machine-readable JSON Schema files are [`public/recipe.schema.json`](../public/recipe.schema.json) and [`public/collection.schema.json`](../public/collection.schema.json). They are generated from Zod, not maintained as separate definitions. Regenerate after schema changes with `node docs/generate-schema.mjs` (Node 22.18+). Runtime validation additionally checks reserved and unique IDs, component references, safe image paths, text-only quantity rules, and timeline bounds that standard JSON Schema cannot fully express here.

A complete importable example is [`public/examples/recipe.json`](../public/examples/recipe.json). All three bundled recipes live in [`src/data/recipes`](../src/data/recipes). Copy an example, give it a new stable `id`, change the content, and import it.

## Recipe fields

| Field | Format and meaning |
| --- | --- |
| `schemaVersion` | Exactly `1`. Other versions are rejected. |
| `id` | Stable recipe identifier, 1–100 characters. Letters, numbers, `.`, `_`, and `-`; start with a letter or number. JavaScript object-property names such as `constructor`, `toString`, and `prototype` are reserved in all ID fields. |
| `name`, `description` | Recipe title and useful introduction. Plain text only. |
| `category` | A library grouping, such as `Weeknight favorites`. |
| `tags`, `dietaryTags` | Arrays of short strings; an empty array is allowed. Be accurate about the complete dish, e.g. `Vegetarian option` for a mixed dinner. |
| `coverImage` | Optional relative image path, e.g. `assets/images/ziti.jpg`, or HTTPS image URL. No data URLs or embedded base64. A missing/unavailable image has a designed fallback. |
| `servings` | Original yield: an integer from 1 to 100. All ingredient scaling uses this immutable base. |
| `servingDescription` | Optional explanation, e.g. `8 beef-loaf portions + 4 vegetarian portions`. |
| `prepMinutes`, `cookMinutes`, `totalMinutes` | Numerical estimates in minutes. Total includes resting and concurrent work; it need not equal prep plus cook. |
| `components` | One or more `{id, name, description?}` entries naming parts of the meal. |
| `ingredients` | One or more structured ingredient entries, described below. |
| `events` | One or more chronological cooking events, described below. |
| `notes` | Array of general cooking notes. |
| `servingInstructions` | Plain-text finishing and serving guidance. |

Required fields must be present. Unknown fields are rejected to catch misspellings. Keep text concise: title 200 characters maximum, most descriptive fields 3,000. Recipe limits are 30 components, 300 ingredients, 200 events, 50 notes, and one week of timeline duration. IDs must be unique within each recipe's components, ingredients, and events. Ingredient and event component references must exist.

## Ingredients

```json
{
  "id": "filling-garlic",
  "componentId": "filling",
  "name": "Garlic",
  "quantity": 3,
  "unit": "cloves",
  "preparation": "Minced",
  "optional": false,
  "scalable": true,
  "groceryCategory": "Produce",
  "shoppingKey": "garlic"
}
```

`quantity` is a positive number, separate from `name`, `unit`, and optional `preparation`. Units may be omitted for countable items such as eggs. `optional` and `scalable` are required booleans. For non-numerical entries, omit `quantity`, set `quantityText` to `to taste` or `as needed`, and set `scalable` to `false`. A numerical ingredient may also be non-scalable. `quantityText`, when used with a quantity, is a short suffix.

`groceryCategory` is one of `Produce`, `Meat`, `Dairy`, `Pantry`, `Bakery`, or `Other`. `shoppingKey` identifies the ingredient across recipes. Reuse `garlic` for garlic cloves in every component and recipe, but distinguish `garlic-powder`. Keep keys specific about meaningful dietary differences; `gf-rolled-oats` and ordinary oats should not share a key.

Shopping merges only equal normalized shopping keys, compatible units, quantity kind (numerical versus text), and quantity text. Simple aliases such as `cups` → `cup` and `tablespoons` → `tbsp` are supported; there is no weight/volume conversion. `8 oz mozzarella` and `¾ cup mozzarella` remain separate. Preparation notes and source recipe names are retained. An item is optional only when every contributing ingredient is optional.

Scaling uses `original quantity × desired servings / recipe servings`. Common fractions are displayed when close to exact, otherwise quantities use short decimals. Times, pan dimensions, and temperatures do not scale. Describe any batch-size or doneness considerations in `notes`.

## Timeline events

```json
{
  "id": "brown-mushrooms",
  "startMinute": 0,
  "durationMinutes": 10,
  "title": "Brown the mushrooms",
  "instruction": "Cook in a hot skillet until browned and the released moisture evaporates.",
  "track": "Vegetables",
  "componentId": "filling",
  "timerMinutes": 8,
  "approximate": true
}
```

`id`, `startMinute`, `title`, `instruction`, and `track` are required. `startMinute` is measured from the beginning of the cooking session, never a wall-clock time, and cannot be after `totalMinutes`. Events are sorted by start time, preserving original order for ties. Equal timestamps and overlapping durations represent parallel work; keep both events.

`durationMinutes` describes the activity's estimated span. `timerMinutes` offers an independent timer that starts only when the cook presses Start. Optional `temperature` and `doneness` strings carry oven settings and thermometer targets. `approximate: true` marks flexible timing. `componentId` is optional for shared preparation or finishing.

Timers use persisted timestamps and remaining durations. Refreshing or backgrounding a loaded tab does not require the timer interval to keep firing. There are no closed-browser notifications. Cooking sessions and timers are separate from ingredient and shopping checklists.

## Collections, duplicate IDs, and backups

A single recipe can be imported directly, or a collection can contain up to 500 recipes:

```json
{
  "schemaVersion": 1,
  "recipes": [
    { "schemaVersion": 1, "id": "your-recipe", "...": "complete recipe fields" }
  ]
}
```

The snippet above illustrates the envelope only; use the complete example when importing. Files must be no larger than 2 MB. The combined collection is also limited to 2 MB of formatted UTF-8 export data so every accepted cookbook can be exported and imported again. The entire file is parsed and validated before the collection changes. Invalid JSON, unsupported versions, validation errors, and oversized combined collections leave the existing collection intact. Errors include field paths.

Choose **Skip duplicates** to retain existing recipes, or **Replace duplicates** to replace the complete recipe with the matching stable ID. Within one file, skip keeps the first occurrence; replace keeps the last. The same policy applies against recipes already in the library. IDs are case-sensitive for recipe identity. Replacements retain compatible extra fields on the recipe and on matching components, ingredients and events. New values explicitly supplied for those fields take precedence.

**Export cookbook** downloads the complete current recipe collection in this versioned format. Importing it restores recipe content; this recipe backup does not include favorites, ingredient ticks, shopping plans, theme, or cooking sessions. Those are separate browser-local preferences and work state. Browser storage can be cleared or unavailable: export recipes regularly. Image paths/URLs are preserved, not bundled in the JSON; move any custom local images with your static site. Remote cover images require a connection, while the bundled local artwork works without one after assets load.

## Sample recipe notes and temperature references

These are original illustrative recipes for Countertop, not an exact private or family recipe. The two-loaf dinner keeps vegetarian preparation separate from raw meat and checks each loaf independently. The sausage recipe specifies pork; its instructions explicitly raise the target if poultry sausage is substituted.

Ground beef and pork sausage use a 160°F / 71°C minimum internal target; egg-containing dishes use the same minimum. Poultry sausage requires 165°F / 74°C. See the [FoodSafety.gov minimum internal temperature chart](https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures) and [USDA guidance for ground beef mixtures](https://ask.fsis.usda.gov/article/To-what-temperature-should-I-cook-beef). Timelines are estimates; doneness is determined with a clean food thermometer.
