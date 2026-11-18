import meatloaf from './recipes/mushroom-meatloaf-dinner.json';
import ziti from './recipes/spinach-mushroom-baked-ziti.json';
import sausage from './recipes/italian-sausage-peppers.json';
import { recipeSchema } from '../domain/schema';

export const sampleRecipes = [meatloaf, ziti, sausage].map((recipe) => recipeSchema.parse(recipe));
