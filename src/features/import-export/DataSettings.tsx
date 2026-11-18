import { useEffect, useRef, useState, type ChangeEvent, type SetStateAction } from 'react';
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, BookOpen, Check, FileJson, HardDrive, Monitor, Moon, RotateCcw, ShieldCheck, Sun, Trash2, X } from 'lucide-react';
import { recipeCollectionSchema, type Recipe } from '../../domain/schema';
import { exportRecipes, MAX_IMPORT_BYTES, mergeRecipes, parseRecipeImport, validateCollectionSize } from '../../domain/importExport';
import { SyncSettings } from '../../sync/SyncSettings';
import { FullBackup } from './FullBackup';
import type { CookbookBackup } from '../../domain/backup';
import { sampleRecipes } from '../../data';
import './data-settings.css';

type Theme = 'light' | 'dark' | 'system';
type Props = {
  restored: boolean;
  onBackupExport: () => void;
  onBackupRestore: (backup: CookbookBackup) => void;
  recipes: Recipe[];
  setRecipes: (next: SetStateAction<Recipe[]>) => Promise<void>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  onReset: () => void;
};

export function DataSettings({ restored, onBackupExport, onBackupRestore, recipes, setRecipes, theme, setTheme, onReset }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [incoming, setIncoming] = useState<Recipe[] | null>(null);
  const [filename, setFilename] = useState('');
  const [behavior, setBehavior] = useState<'skip' | 'replace'>('skip');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { if (restored) setNotice('Full cookbook restored. Saved cooking clocks and timers are paused; resume them when you are ready.'); }, [restored]);
  const [reading, setReading] = useState(false);
  const missingExamples = sampleRecipes.filter(sample => !recipes.some(recipe => recipe.id === sample.id));
  const seenIds = new Set(recipes.map(recipe => recipe.id));
  const duplicateCount = incoming?.reduce((count, recipe) => { const duplicate = seenIds.has(recipe.id); seenIds.add(recipe.id); return count + Number(duplicate); }, 0) ?? 0;
  const preview = incoming ? mergeRecipes(recipes, incoming, behavior) : null;

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(''); setNotice(''); setIncoming(null); setReading(true);
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error(`This file is too large. Choose a JSON file smaller than ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB. Keep image files separate from recipe JSON.`);
      const parsed = parseRecipeImport(await file.text());
      setIncoming(parsed); setFilename(file.name); setBehavior('skip');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This file could not be read. Please choose a valid recipe JSON file.');
    } finally { setReading(false); }
  }

  async function applyImport() {
    if (!incoming || !preview) return;
    const validated = recipeCollectionSchema.safeParse({ schemaVersion: 1, recipes: preview.recipes });
    if (!validated.success) {
      setError(`The combined collection could not be saved. ${validated.error.issues.map(issue => issue.message).join(' ')}`);
      return;
    }
    try { validateCollectionSize(preview.recipes); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The combined collection is too large.'); return; }
    setError('');
    try { await setRecipes(preview.recipes); } catch (e) { setError(String(e)); return; }
    setNotice(`Import complete. ${preview.added} added, ${preview.replaced} replaced, ${preview.skipped} skipped.`);
    setIncoming(null);
  }

  function download() {
    setError('');
    try {
      const blob = new Blob([exportRecipes(recipes)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `countertop-recipes-${new Date().toLocaleDateString('en-CA')}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Recipe collection exported: ${recipes.length} ${recipes.length === 1 ? 'recipe' : 'recipes'}. Keep this file somewhere safe.`);
    } catch { setError('The download could not be created. Please try again.'); }
  }

  async function removeRecipe(recipe: Recipe) {
    if (!window.confirm(`Remove “${recipe.name}” from your cookbook? Its personal shopping note and cooking progress will also be removed. Connected devices will receive a deletion for a shared recipe. Recipe exports do not include personal shopping notes.`)) return;
    try { await setRecipes(previous => previous.filter(existing => existing.id !== recipe.id)); } catch (e) { setError(String(e)); return; }
    setNotice(`“${recipe.name}” removed from your cookbook.`);
  }

  async function restoreExamples() {
    const restored = mergeRecipes(recipes, sampleRecipes, 'skip');
    const validated = recipeCollectionSchema.safeParse({ schemaVersion: 1, recipes: restored.recipes });
    if (!validated.success) {
      setError('There is not enough room in this collection to restore the examples. Remove a recipe first; collections can contain up to 500 recipes.');
      return;
    }
    try { validateCollectionSize(restored.recipes); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The combined collection is too large.'); return; }
    setError('');
    try { await setRecipes(restored.recipes); } catch (e) { setError(String(e)); return; }
    setNotice(`${restored.added} ${restored.added === 1 ? 'example recipe' : 'example recipes'} restored to your cookbook.`);
  }

  return <div className="data-page">
    <header className="data-heading"><p className="eyebrow">A COOKBOOK THAT’S YOURS</p><h1>Make yourself at home.</h1><p>Your recipes, your preferences, and a little peace of mind.</p></header>
    <div className="data-layout">
      <div className="data-main">
        <SyncSettings onBackup={onBackupExport}/>
        <section className="data-section card" aria-labelledby="recipe-data-title">
          <div className="data-section-title"><span className="data-section-icon"><BookOpen size={20} /></span><div><h2 id="recipe-data-title">Your recipe collection</h2><p>{recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}, kept right in this browser.</p></div></div>
          <div className="data-transfer-grid">
            <button className="data-transfer" onClick={() => fileInput.current?.click()} disabled={reading}><ArrowUpFromLine size={24} strokeWidth={1.5} /><strong>{reading ? 'Reading your file…' : 'Import recipes'}</strong><span>Add one recipe or a whole collection from a JSON file.</span><span className="data-transfer-link">Choose a file <span aria-hidden="true">↗</span></span></button>
            <button className="data-transfer" onClick={download}><ArrowDownToLine size={24} strokeWidth={1.5} /><strong>Export your cookbook</strong><span>Download recipe-only JSON to share or reimport.</span><span className="data-transfer-link">Download JSON <span aria-hidden="true">↗</span></span></button>
          </div>
          <input ref={fileInput} className="data-file-input" id="recipe-import" type="file" accept=".json,application/json" onChange={event => void readFile(event)} aria-label="Import recipe JSON file" tabIndex={-1} />
          {error && <div className="data-feedback data-error" role="alert"><AlertCircle size={19} /><div><strong>We couldn’t finish that.</strong><pre>{error}</pre><p>Your existing recipes have not changed.</p></div><button className="btn btn-icon" aria-label="Dismiss import error" onClick={() => setError('')}><X size={17} /></button></div>}
          {notice && <div className="data-feedback data-success" role="status"><Check size={19} /><p>{notice}</p><button className="btn btn-icon" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={17} /></button></div>}
          {incoming && preview && <section className="data-import-preview" aria-label="Review recipe import">
            <p className="eyebrow">READY TO BRING INTO YOUR COOKBOOK</p><h3>{incoming.length} {incoming.length === 1 ? 'recipe' : 'recipes'} found</h3><p className="data-filename"><FileJson size={15} />{filename}</p>
            <ul>{incoming.map((recipe, index) => <li key={`${recipe.id}-${index}`}><span>{recipe.name}</span>{recipes.some(existing => existing.id === recipe.id) && <span className="data-existing-tag">Already in library</span>}</li>)}</ul>
            {duplicateCount > 0 && <fieldset className="data-duplicate-options"><legend>{duplicateCount} {duplicateCount === 1 ? 'entry shares' : 'entries share'} a recipe ID with your library or this file. How should we handle them?</legend><label><input type="radio" name="duplicate-behavior" value="skip" checked={behavior === 'skip'} onChange={() => setBehavior('skip')} /><span><strong>Keep existing recipes</strong><small>Skip matching IDs. For repeated IDs in this file, keep the first entry.</small></span></label><label><input type="radio" name="duplicate-behavior" value="replace" checked={behavior === 'replace'} onChange={() => setBehavior('replace')} /><span><strong>Replace matching recipes</strong><small>Use the file’s recipe for matching IDs and share the replacement if sync is connected. For repeated IDs, use the last entry.</small></span></label></fieldset>}
            <p className="data-import-counts">{preview.added} new · {preview.replaced} replacements · {preview.skipped} skipped</p><div className="data-preview-actions"><button className="btn btn-primary" onClick={applyImport}>Import recipes <Check size={16} /></button><button className="btn btn-secondary" onClick={() => setIncoming(null)}>Cancel</button></div>
          </section>}
          <div className="data-format-note"><FileJson size={18} /><p>Recipes use Countertop’s version 1 JSON format. <a href={`${import.meta.env.BASE_URL}examples/recipe.json`} download="countertop-example-recipe.json">Download a complete example</a> to use as a starting point.</p></div>
        </section>

        <FullBackup currentRecipeCount={recipes.length} onExport={onBackupExport} onRestore={onBackupRestore}/>

        <section className="data-section card" aria-labelledby="appearance-title"><div className="data-section-title"><span className="data-section-icon"><Sun size={20} /></span><div><h2 id="appearance-title">A light for every kitchen</h2><p>Choose what feels comfortable at your counter.</p></div></div><fieldset className="data-theme-options"><legend className="data-visually-hidden">Appearance</legend>{([{ id: 'light', label: 'Light', icon: Sun }, { id: 'dark', label: 'Dark', icon: Moon }, { id: 'system', label: 'System', icon: Monitor }] as const).map(option => <label key={option.id} className={theme === option.id ? 'is-selected' : ''}><input type="radio" name="theme" value={option.id} checked={theme === option.id} onChange={() => setTheme(option.id)} /><option.icon size={22} strokeWidth={1.5} /><span>{option.label}</span>{theme === option.id && <Check size={14} className="data-theme-check" />}</label>)}</fieldset></section>

        <section className="data-section card" aria-labelledby="manage-recipes-title"><div className="data-section-title"><span className="data-section-icon"><FileJson size={20} /></span><div><h2 id="manage-recipes-title">On your bookshelf</h2><p>A little room to keep your collection considered.</p></div></div>{recipes.length > 0 ? <ul className="data-imported-list">{recipes.map(recipe => {
          const sample = sampleRecipes.find(example => example.id === recipe.id);
          const origin = sample ? JSON.stringify(sample) === JSON.stringify(recipe) ? 'Included example' : 'Imported version of an example' : 'Imported recipe';
          return <li key={recipe.id}><span><strong>{recipe.name}</strong><small>{recipe.category} · {origin}</small></span><button className="btn btn-icon" aria-label={`Remove ${recipe.name}`} onClick={() => removeRecipe(recipe)}><Trash2 size={18} /></button></li>;
        })}</ul> : <div className="data-empty-recipes"><p>Your bookshelf is ready for its first recipe. Bring in a JSON file or begin with our three dinner recipes.</p><button className="btn btn-secondary" onClick={() => fileInput.current?.click()}><ArrowUpFromLine size={16} />Import a recipe</button></div>}{missingExamples.length > 0 && <div className="data-restore-examples"><p>Add {missingExamples.length} missing {missingExamples.length === 1 ? 'example recipe' : 'example recipes'} to your collection.</p><button className="btn btn-secondary" onClick={restoreExamples}><RotateCcw size={16} />Restore sample recipes</button></div>}</section>

        <section className="data-reset-section"><div><h2>A fresh start</h2><p>Reset this browser’s recipes, favorites, checklists, shopping list, personal shopping notes, and cooking sessions. The three sample recipes will return.</p></div><button className="btn btn-secondary" onClick={() => { if (window.confirm('Reset all Countertop data in this browser? This removes imported recipes, favorites, checklists, shopping selections, personal shopping notes, cooking sessions, and preferences. Download a full cookbook backup first to keep your recipes and progress. This cannot be undone.')) onReset(); }}><RotateCcw size={16} />Reset all data</button></section>
      </div>

      <aside className="data-sidebar"><section className="data-backup-note"><HardDrive size={24} strokeWidth={1.4} /><p className="eyebrow">A NOTE ON KEEPING THINGS</p><h2>Save a copy.<br />Keep your place.</h2><p>Your cookbook is saved in this browser. Connected devices also receive shared recipes. Clearing browser data, using private browsing, or changing devices can remove it.</p><p>Download a full cookbook backup regularly and keep the JSON file somewhere safe. Restore it to bring back recipes, personal notes, and progress together.</p><button className="btn btn-secondary" onClick={()=>{const section=document.getElementById('full-cookbook-backup');section?.scrollIntoView({block:'start'});section?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});}}><ArrowDownToLine size={16} />Full backup options</button><small>Recipe-only exports contain recipes. Use Full cookbook backup to include personal notes, checklists, favorites, shopping selections, preferences, and saved cooking sessions.</small></section><section className="data-about"><ShieldCheck size={20} /><h3>Made for your kitchen.</h3><p>Cook offline and connect your household when you want to share recipes.</p><p>Countertop <span>v0.1</span></p><small>Cooking timers keep time while you’re away and restore on refresh. Keep this page open for visible alerts; notifications are not sent when the browser is closed.</small></section></aside>
    </div>
  </div>;
}
