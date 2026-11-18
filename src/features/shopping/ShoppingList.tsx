import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Check, CheckCheck, ChevronRight, Clock3, Copy, Leaf, Minus, Plus, Printer, RotateCcw, ShoppingBasket, X } from 'lucide-react';
import { z } from 'zod';
import type { Recipe } from '../../domain/schema';
import { aggregateShopping, shoppingItemAmount, type ShoppingSelection } from '../../domain/shopping';
import { usePersistentState } from '../../storage/usePersistentState';
import { shoppingNoteText, type ShoppingNotes } from '../../domain/shoppingNotes';
import { reconcileShoppingChecklist, shoppingCompletionKey } from './checklist';
import './shopping.css';

type Props = {
  recipes: Recipe[];
  shoppingNotes: ShoppingNotes;
  selections: ShoppingSelection[];
  setSelections: Dispatch<SetStateAction<ShoppingSelection[]>>;
  onBrowse: () => void;
};

const checklistSchema = z.object({ checked: z.array(z.string()), hidden: z.array(z.string()) });
const categories = ['Produce', 'Meat', 'Dairy', 'Pantry', 'Bakery', 'Other'];

export function ShoppingList({ recipes, shoppingNotes, selections, setSelections, onBrowse }: Props) {
  const [checklist, setChecklist] = usePersistentState('shopping-checklist', checklistSchema, { checked: [], hidden: [] });
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const items = useMemo(() => aggregateShopping(recipes, selections).map(item => ({ ...item, completionKey: shoppingCompletionKey(item) })), [recipes, selections]);
  const visible = items.filter(item => !checklist.hidden.includes(item.completionKey));
  const purchased = items.filter(item => checklist.checked.includes(item.completionKey));
  useEffect(() => {
    const reconciled = reconcileShoppingChecklist(checklist, new Set(items.map(item => item.completionKey)));
    if (reconciled !== checklist) setChecklist(reconciled);
  }, [items, checklist, setChecklist]);
  const selectedRecipes = selections.flatMap(selection => {
    const recipe = recipes.find(candidate => candidate.id === selection.recipeId);
    return recipe ? [{ ...selection, recipe }] : [];
  });
  const plainText = ['COUNTERTOP · SHOPPING LIST', '', ...selectedRecipes.flatMap(({ recipe, servings }) => [`${recipe.name} · ${servings} servings`, ...shoppingNoteText(shoppingNotes[recipe.id])]), '', ...categories.flatMap(category => {
    const group = visible.filter(item => item.groceryCategory === category);
    return group.length ? [category.toUpperCase(), ...group.map(item => `${checklist.checked.includes(item.completionKey) ? '[x]' : '[ ]'} ${shoppingItemAmount(item)} ${item.name}${item.optional ? ' (optional)' : ''}${item.preparations.length ? ` — ${item.preparations.join('; ')}` : ''}`), ''] : [];
  })].join('\n');

  function changeServings(recipeId: string, servings: number) {
    setSelections(previous => previous.map(selection => selection.recipeId === recipeId ? { ...selection, servings: Math.max(1, Math.min(100, Math.round(servings))) } : selection));
  }

  function toggle(key: string) {
    setChecklist(previous => ({ ...previous, checked: previous.checked.includes(key) ? previous.checked.filter(item => item !== key) : [...previous.checked, key] }));
  }

  async function copyList() {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(plainText);
      setCopyState('copied');
    } catch {
      setCopyState('manual');
    }
  }

  return <div className="shopping-page">
    <header className="shopping-heading">
      <div><p className="eyebrow">FROM YOUR RECIPES, TO YOUR BASKET</p><h1>The shopping list.</h1><p>A little preparation. A much calmer kitchen.</p></div>
      {items.length > 0 && <div className="shopping-export-actions"><button className="btn btn-secondary" onClick={() => void copyList()}><Copy size={17} />{copyState === 'copied' ? 'Copied' : 'Copy list'}</button><button className="btn btn-icon" aria-label="Print shopping list" title="Print shopping list" onClick={() => window.print()}><Printer size={19} /></button></div>}
    </header>

    {selectedRecipes.length === 0 ? <section className="shopping-empty card">
      <div className="shopping-empty-icon"><ShoppingBasket size={34} strokeWidth={1.3} /></div>
      <p className="eyebrow">GOOD MEALS START HERE</p><h2>What’s on the menu?</h2><p>Add a recipe from your cookbook. We’ll gather its ingredients here and combine the things you need more than once.</p><button className="btn btn-primary" onClick={onBrowse}>Explore your cookbook <ChevronRight size={18} /></button>
    </section> : <div className="shopping-layout">
      <aside className="shopping-plan">
        <div className="shopping-plan-title"><p className="eyebrow">ON YOUR MENU</p><span>{selectedRecipes.length} {selectedRecipes.length === 1 ? 'recipe' : 'recipes'}</span></div>
        {selectedRecipes.map(({ recipe, servings }) => <article className="shopping-recipe card" key={recipe.id}>
          <div className="shopping-recipe-top"><h3>{recipe.name}</h3><button className="btn btn-icon" aria-label={`Remove ${recipe.name} from shopping list`} onClick={() => setSelections(previous => previous.filter(selection => selection.recipeId !== recipe.id))}><X size={17} /></button></div>
          <p>{recipe.category}</p>{shoppingNotes[recipe.id]&&<div className="shopping-recipe-note"><strong>Shopping note</strong><p>{shoppingNotes[recipe.id]}</p><a href={`#/recipe/${recipe.id}/overview`}>Edit note in recipe</a></div>}<div className="shopping-serving-row"><span>Servings</span><div className="shopping-stepper"><button aria-label={`Fewer servings of ${recipe.name}`} disabled={servings <= 1} onClick={() => changeServings(recipe.id, servings - 1)}><Minus size={15} /></button><output aria-label={`${recipe.name} servings`}>{servings}</output><button aria-label={`More servings of ${recipe.name}`} disabled={servings >= 100} onClick={() => changeServings(recipe.id, servings + 1)}><Plus size={15} /></button></div></div>
        </article>)}
        <a className="btn btn-primary shopping-timing-link" href="#/shopping/timing"><Clock3 size={17}/>Time this dinner</a>
        <p className="shopping-timing-note">Choose a serving time and bring these recipes together in one cooking timeline.</p>
        <button className="shopping-add btn btn-secondary" onClick={onBrowse}><Plus size={17} />Add another recipe</button>
        <p className="shopping-plan-note"><Leaf size={17} />Matching ingredients are gathered together. Different units stay separate.</p>
      </aside>

      <section className="shopping-groceries" aria-label="Combined grocery list">
        <div className="shopping-progress"><div><span className="eyebrow">YOUR BASKET</span><p><strong>{purchased.length}</strong> of {items.length} items collected</p></div><div className="shopping-progress-circle"><CheckCheck size={22} /></div></div>
        <div className="shopping-progress-bar" role="progressbar" aria-label="Shopping progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={purchased.length}><span style={{ width: `${items.length ? purchased.length / items.length * 100 : 0}%` }} /></div>
        <div className="shopping-list-actions"><button className="btn shopping-text-button" disabled={purchased.filter(item => !checklist.hidden.includes(item.completionKey)).length === 0} onClick={() => setChecklist(previous => ({ ...previous, hidden: [...new Set([...previous.hidden, ...previous.checked])] }))}><Check size={16} />Clear purchased</button><button className="btn shopping-text-button" disabled={checklist.checked.length === 0 && checklist.hidden.length === 0} onClick={() => setChecklist({ checked: [], hidden: [] })}><RotateCcw size={15} />Reset checklist</button></div>
        {categories.map(category => {
          const group = visible.filter(item => item.groceryCategory === category);
          return group.length > 0 && <section className="shopping-category" key={category}>
            <h2>{category}<span>{group.length}</span></h2>
            <ul>{group.map(item => <li key={item.key} className={checklist.checked.includes(item.completionKey) ? 'is-checked' : ''}>
              <label className="shopping-item"><input type="checkbox" checked={checklist.checked.includes(item.completionKey)} onChange={() => toggle(item.completionKey)} /><span className="shopping-checkbox" aria-hidden="true">{checklist.checked.includes(item.completionKey) && <Check size={16} strokeWidth={2.5} />}</span><span className="shopping-item-content"><span className="shopping-item-main"><span className="shopping-item-name">{item.name}</span><span className="shopping-item-amount">{shoppingItemAmount(item)}</span></span>{item.preparations.length > 0 && <span className="shopping-item-notes">{item.preparations.join(' · ')}</span>}{item.optional && <span className="shopping-optional">Optional</span>}</span></label>
            </li>)}</ul>
          </section>;
        })}
        {items.length > 0 && visible.length === 0 && <div className="shopping-all-done"><CheckCheck size={32} /><h2>Basket complete.</h2><p>You’re ready to head to the kitchen.</p><button className="btn btn-secondary" onClick={() => setChecklist({ checked: [], hidden: [] })}>Restore the list</button></div>}
        {items.length - visible.length > 0 && visible.length > 0 && <p className="shopping-hidden-note">{items.length - visible.length} purchased {items.length - visible.length === 1 ? 'item hidden' : 'items hidden'}. Reset the checklist to show everything.</p>}
      </section>
    </div>}

    {copyState === 'manual' && <section className="shopping-copy-fallback card" aria-label="Copy shopping list"><div><h2>Your list, ready to copy</h2><button className="btn btn-icon" onClick={() => setCopyState('idle')} aria-label="Close copy list"><X size={18} /></button></div><p>Clipboard access is unavailable here. Select and copy the text below.</p><textarea aria-label="Shopping list text" readOnly value={plainText} onFocus={event => event.currentTarget.select()} rows={10} /><button className="btn btn-secondary" onClick={event => { const textarea = event.currentTarget.parentElement?.querySelector('textarea'); textarea?.focus(); textarea?.select(); }}>Select all text</button></section>}
    <span className="shopping-copy-status" role="status">{copyState === 'copied' ? 'Shopping list copied to clipboard.' : ''}</span>
  </div>;
}
