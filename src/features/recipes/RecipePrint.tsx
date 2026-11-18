import { useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { recipeSchema, type Recipe } from '../../domain/schema';
import { ingredientAmount } from '../../domain/scaling';
import { formatMinute, sortedEvents } from '../../domain/timeline';
import './recipe-print.css';

interface Props {
  recipe: Recipe;
  servings: number;
}

/** Mount within .recipe-detail. The paper copy is complete in every recipe mode. */
export function RecipePrint({ recipe, servings }: Props) {
  const [feedback, setFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const events = sortedEvents(recipe.events);

  function downloadRecipe() {
    try {
      // Export the immutable source recipe, never the scaled quantities shown on paper.
      const source = recipeSchema.parse(recipe);
      const blob = new Blob([JSON.stringify(source, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${recipe.id}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setFeedback({ message: `Recipe JSON downloaded with the original ${recipe.servings}-serving quantities. You can share or import this file.`, error: false });
    } catch {
      setFeedback({ message: 'The recipe file could not be created. Please try again.', error: true });
    }
  }

  return <>
    <div className="recipe-print-actions">
      <div className="recipe-print-buttons">
        <button className="btn btn-secondary" onClick={() => window.print()}><Printer size={17} aria-hidden="true" />Print recipe</button>
        <button className="btn btn-secondary" onClick={downloadRecipe}><Download size={17} aria-hidden="true" />Export recipe JSON</button>
      </div>
      <p className="recipe-print-caption">Print for {servings} servings, or share the original recipe as JSON.</p>
      {feedback && <p className={`recipe-print-feedback${feedback.error ? ' is-error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
    </div>

    <article className="recipe-print-sheet" aria-label={`Printable recipe: ${recipe.name}`}>
      <header className="recipe-paper-header">
        <p className="recipe-paper-brand">COUNTERTOP · YOUR RECIPE COLLECTION</p>
        <h1>{recipe.name}</h1>
        <p className="recipe-paper-description">{recipe.description}</p>
        <p className="recipe-paper-tags">{[recipe.category, ...recipe.dietaryTags].join(' · ')}</p>
        <dl className="recipe-paper-facts">
          <div><dt>Servings</dt><dd>{servings}</dd></div>
          <div><dt>Preparation</dt><dd>{recipe.prepMinutes} min</dd></div>
          <div><dt>Cooking</dt><dd>{recipe.cookMinutes} min</dd></div>
          <div><dt>Total estimate</dt><dd>{recipe.totalMinutes} min</dd></div>
        </dl>
        {recipe.servingDescription && <p className="recipe-paper-yield">Original {recipe.servings}-serving recipe: {recipe.servingDescription}</p>}
        <p className="recipe-paper-scaling">Ingredient quantities are shown for {servings} servings{servings !== recipe.servings ? `, scaled from ${recipe.servings}` : ''}. Cooking times, temperatures, and pan sizes remain unchanged. Check doneness independently when changing portions.</p>
      </header>

      <section className="recipe-paper-ingredients" aria-label="Ingredients for printing">
        <h2>Ingredients</h2>
        {recipe.components.map(component => {
          const ingredients = recipe.ingredients.filter(ingredient => ingredient.componentId === component.id);
          return <section className="recipe-paper-component" key={component.id}>
            <h3>{component.name}</h3>
            {component.description && <p className="recipe-paper-component-description">{component.description}</p>}
            {ingredients.length > 0 && <ul>{ingredients.map(ingredient => <li key={ingredient.id}>
              <span className="recipe-paper-checkbox" aria-hidden="true" />
              <span><strong>{ingredientAmount(ingredient, recipe.servings, servings)}</strong> {ingredient.name}{ingredient.optional && <em> (optional)</em>}{ingredient.preparation && <span className="recipe-paper-preparation"> — {ingredient.preparation}</span>}</span>
            </li>)}</ul>}
          </section>;
        })}
      </section>

      <section className="recipe-paper-timeline" aria-label="Cooking instructions for printing">
        <h2>The cooking timeline</h2>
        <p className="recipe-paper-timeline-note">Times are relative to the start. Work on overlapping tracks as needed; timing is a guide and doneness takes priority.</p>
        <ol>{events.map((event, index) => <li key={event.id}>
          <p className="recipe-paper-event-meta"><span>{event.approximate ? 'Around ' : ''}+{formatMinute(event.startMinute)}</span> · {event.track}{event.durationMinutes !== undefined && ` · ${event.durationMinutes} min`}{event.timerMinutes !== undefined && ` · Optional ${event.timerMinutes}-minute timer`}</p>
          <h3>{index + 1}. {event.title}</h3>
          <p className="recipe-paper-instruction">{event.instruction}</p>
          {(event.temperature || event.doneness) && <p className="recipe-paper-doneness">{event.temperature && <strong>{event.temperature}{event.doneness ? ' — ' : ''}</strong>}{event.doneness}</p>}
        </li>)}</ol>
      </section>

      {recipe.notes.length > 0 && <section className="recipe-paper-notes"><h2>Notes from the kitchen</h2><ul>{recipe.notes.map((note, index) => <li key={index}>{note}</li>)}</ul></section>}
      <section className="recipe-paper-serving"><h2>To the table</h2><p>{recipe.servingInstructions}</p></section>
      <footer className="recipe-paper-footer">Countertop · {recipe.name} · {servings} servings</footer>
    </article>
  </>;
}
