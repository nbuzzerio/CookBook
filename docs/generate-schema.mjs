// Run with Node 22.18+ from the repository root: node docs/generate-schema.mjs
// Generated from the same Zod definitions used by the application, never maintained separately.
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { recipeSchema, recipeCollectionSchema } from '../src/domain/schema.ts';

for (const [filename, schema, title] of [
  ['recipe.schema.json', recipeSchema, 'Countertop recipe · version 1'],
  ['collection.schema.json', recipeCollectionSchema, 'Countertop recipe collection · version 1'],
]) {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  await writeFile(new URL(`../public/${filename}`, import.meta.url), `${JSON.stringify({ ...jsonSchema, title, $comment: 'Generated from src/domain/schema.ts. Zod runtime validation additionally checks reserved and unique IDs, component references, safe image paths, text-only quantity rules, and timeline bounds. Do not edit this generated file directly.' }, null, 2)}\n`);
  console.log(`Generated public/${filename}`);
}
