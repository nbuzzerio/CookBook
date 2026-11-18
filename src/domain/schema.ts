import { z } from 'zod';

const reservedIds = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
const id = z.string().min(1).max(100)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, 'Use letters, numbers, hyphens, underscores, or periods for IDs')
  .refine((value) => !reservedIds.has(value), 'This ID is reserved by JavaScript. Choose a unique descriptive ID such as mushroom-dinner or brown-mushrooms.');
const text = z.string().trim().min(1).max(3000);
const minutes = z.number().finite().min(0).max(10080);
const coverImage = z.string().max(500).refine((value) => {
  if (/^https:\/\//i.test(value)) {
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  }
  return /^(?!\/)(?!.*\.\.)(?!.*[:\\?#])[a-zA-Z0-9_./ -]+\.(?:png|jpe?g|webp|avif|svg)$/i.test(value);
}, 'Cover images must be a relative image path or an HTTPS URL; embedded images are not supported');

export const ingredientSchema = z.object({
  id,
  componentId: id,
  name: text,
  quantity: z.number().finite().positive().max(1000000).optional(),
  unit: z.string().trim().max(80).optional(),
  quantityText: z.string().trim().min(1).max(160).optional(),
  preparation: text.optional(),
  optional: z.boolean(),
  scalable: z.boolean(),
  groceryCategory: z.enum(['Produce', 'Meat', 'Dairy', 'Pantry', 'Bakery', 'Other']),
  shoppingKey: id,
}).strict().superRefine((ingredient, ctx) => {
  if (ingredient.quantity === undefined && !ingredient.quantityText) {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['quantity'], message: 'Supply a numerical quantity or quantityText such as "to taste"'});
  }
  if (ingredient.scalable && ingredient.quantity === undefined) {
    ctx.addIssue({code: z.ZodIssueCode.custom, path: ['scalable'], message: 'Text-only quantities must use scalable: false'});
  }
});

export const cookingEventSchema = z.object({
  id,
  startMinute: minutes,
  durationMinutes: minutes.optional(),
  title: text,
  instruction: text,
  track: z.string().trim().min(1).max(100),
  componentId: id.optional(),
  timerMinutes: z.number().finite().positive().max(10080).optional(),
  temperature: z.string().trim().min(1).max(300).optional(),
  doneness: text.optional(),
  approximate: z.boolean().optional(),
}).strict();

export const recipeSchema = z.object({
  schemaVersion: z.literal(1),
  id,
  name: z.string().trim().min(1).max(200),
  description: text,
  category: z.string().trim().min(1).max(80),
  tags: z.array(z.string().trim().min(1).max(80)).max(30),
  dietaryTags: z.array(z.string().trim().min(1).max(80)).max(20),
  coverImage: coverImage.optional(),
  servings: z.number().int().min(1).max(100),
  servingDescription: text.optional(),
  prepMinutes: minutes,
  cookMinutes: minutes,
  totalMinutes: z.number().finite().positive().max(10080),
  components: z.array(z.object({id, name: z.string().trim().min(1).max(100), description: text.optional()}).strict()).min(1).max(30),
  ingredients: z.array(ingredientSchema).min(1).max(300),
  events: z.array(cookingEventSchema).min(1).max(200),
  notes: z.array(text).max(50),
  servingInstructions: text,
}).strict().superRefine((recipe, ctx) => {
  for (const field of ['components', 'ingredients', 'events'] as const) {
    const seen = new Set<string>();
    recipe[field].forEach((entry, index) => {
      if (seen.has(entry.id)) ctx.addIssue({code: z.ZodIssueCode.custom, path: [field, index, 'id'], message: `Duplicate ${field} ID: ${entry.id}`});
      seen.add(entry.id);
    });
  }
  const componentIds = new Set(recipe.components.map((component) => component.id));
  recipe.ingredients.forEach((ingredient, index) => {
    if (!componentIds.has(ingredient.componentId)) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['ingredients', index, 'componentId'], message: 'Component reference does not exist'});
  });
  recipe.events.forEach((event, index) => {
    if (event.componentId && !componentIds.has(event.componentId)) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['events', index, 'componentId'], message: 'Component reference does not exist'});
    if (event.startMinute > recipe.totalMinutes) ctx.addIssue({code: z.ZodIssueCode.custom, path: ['events', index, 'startMinute'], message: 'Event starts after the recipe total time'});
  });
});

export const recipeCollectionSchema = z.object({
  schemaVersion: z.literal(1),
  recipes: z.array(recipeSchema).max(500),
}).strict();

export type Recipe = z.infer<typeof recipeSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type CookingEvent = z.infer<typeof cookingEventSchema>;
export type RecipeCollection = z.infer<typeof recipeCollectionSchema>;
