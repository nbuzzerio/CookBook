import { useEffect, useState, useSyncExternalStore } from 'react';
import type { SetStateAction } from 'react';
import { z } from 'zod';
import { AlertCircle, ArrowLeft, BookOpen, CookingPot, Moon, Settings2, ShoppingBasket, Sun, Upload } from 'lucide-react';
import { SyncButton } from '../sync/SyncSettings';
import { afterSave } from '../sync/engine';
import { editNote, visibleNotes } from '../sync/model';
import { assertLibrary, change, replaceFromBackup, resetBackup, saveRecipes, snapshot, subscribe } from '../sync/store';
import type { Recipe } from '../domain/schema';
import type { ShoppingSelection } from '../domain/shopping';
import { createFullBackup, RestoreRecoveryRequired } from '../storage/backup';
import { RestoreRecovery } from '../storage/RestoreRecovery';
import { serializeBackup, type CookbookBackup } from '../domain/backup';
import { usePersistentState } from '../storage/usePersistentState';
import { removeStored, reportStorageWarning, storageWarning, subscribeStorage } from '../storage/persistence';
import { Library } from '../features/library/Library';
import { RecipeDetail } from '../features/recipes/RecipeDetail';
import type { RecipeMode } from '../features/recipes/RecipeDetail';
import { ShoppingList } from '../features/shopping/ShoppingList';
import { DataSettings } from '../features/import-export/DataSettings';
import { DinnerTimeline } from '../features/dinner/DinnerTimeline';
import { useTheme, type Theme } from './useTheme';

const selectionsSchema=z.array(z.object({recipeId:z.string(),servings:z.number().min(1).max(100)}));
const servingSchema=z.record(z.string(),z.number().min(1).max(100));
function currentRoute(){return window.location.hash.slice(1)||'/';}
export function App(){
  const {restoreId}=useSyncExternalStore(subscribe,snapshot);
  const [completedRestore,setCompletedRestore]=useState<string>();
  const [needsRecovery,setNeedsRecovery]=useState(false);
  if(needsRecovery)return <RestoreRecovery/>;
  return <CookbookApp key={restoreId ?? 'initial'} restored={!!restoreId&&completedRestore===restoreId} onRestored={()=>setCompletedRestore(snapshot().restoreId)} onRecoveryRequired={()=>setNeedsRecovery(true)}/>;
}
function CookbookApp({restored,onRestored,onRecoveryRequired}:{restored:boolean;onRestored:()=>void;onRecoveryRequired:()=>void}){
  const cookbook=useSyncExternalStore(subscribe,snapshot);
  const {recipes}=cookbook;
  const [favorites,setFavorites]=usePersistentState<string[]>('favorites',z.array(z.string()),[]);
  const [theme,setTheme]=usePersistentState<Theme>('theme',z.enum(['light','dark','system']),'system');
  const [selections,setSelections]=usePersistentState<ShoppingSelection[]>('shopping-plan',selectionsSchema,[]);
  const [servingsByRecipe,setServingsByRecipe]=usePersistentState<Record<string,number>>('servings',servingSchema,{});
  const shoppingNotes=visibleNotes(cookbook);
  const [route,setRoute]=useState(currentRoute);
  const warning=useSyncExternalStore(subscribeStorage,storageWarning);
  useEffect(()=>{const handler=()=>{setRoute(currentRoute());window.scrollTo({top:0,behavior:'instant'});};window.addEventListener('hashchange',handler);return()=>window.removeEventListener('hashchange',handler);},[]);
  const resolvedTheme=useTheme(theme);
  const navigate=(path:string)=>{window.location.hash=path;};
  const parts=route.split('/');
  const recipe=parts[1]==='recipe'?recipes.find(r=>r.id===parts[2]):undefined;
  const mode:RecipeMode=['overview','ingredients','timeline','cook'].includes(parts[3])?parts[3] as RecipeMode:'overview';
  const active=parts[1]==='shopping'?'shopping':parts[1]==='settings'?'settings':'library';
  const toggleFavorite=(id:string)=>setFavorites(previous=>previous.includes(id)?previous.filter(x=>x!==id):[...previous,id]);
  async function setRecipes(next:SetStateAction<Recipe[]>) {
    const updated=typeof next==='function'?next(recipes):next;
    await saveRecipes(cookbook, updated);
    afterSave();
    const removedIds=new Set<string>();
    for(const old of recipes) {
      const replacement=updated.find(r=>r.id===old.id);
      if(!replacement) removedIds.add(old.id);
      if(!replacement || (!cookbook.scope && JSON.stringify(old)!==JSON.stringify(replacement))) {
        removeStored(`session:${old.id}`);
        removeStored(`ingredients:${old.id}`);
      }
    }
    if(removedIds.size){
      setFavorites(previous=>previous.filter(id=>!removedIds.has(id)));
      setSelections(previous=>previous.filter(selection=>!removedIds.has(selection.recipeId)));
    }

  }
  const setRecipeServings=(id:string,servings:number)=>{setServingsByRecipe(previous=>({...previous,[id]:servings}));setSelections(previous=>previous.map(s=>s.recipeId===id?{...s,servings}:s));};
  const effectiveServings=recipe?(selections.find(s=>s.recipeId===recipe.id)?.servings??servingsByRecipe[recipe.id]??recipe.servings):1;
  function downloadFullBackup() {
    const backup=createFullBackup({recipes,favorites,theme,shoppingPlan:selections,servings:servingsByRecipe,shoppingNotes});
    const url=URL.createObjectURL(new Blob([serializeBackup(backup)],{type:'application/json'}));
    const link=document.createElement('a');
    link.href=url;link.download=`countertop-full-backup-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function applyFullBackup(backup:CookbookBackup) {
    try { await replaceFromBackup(backup); afterSave(); }
    catch(cause) {
      if(cause instanceof RestoreRecoveryRequired)onRecoveryRequired();
      throw cause;
    }
    window.scrollTo({top:0,behavior:'instant'});
    onRestored();
  }
  const nav=[{id:'library',label:'Library',path:'/',Icon:BookOpen},{id:'shopping',label:'Shopping list',path:'/shopping',Icon:ShoppingBasket},{id:'settings',label:'Settings & data',path:'/settings',Icon:Settings2}];
  return <div className={`app-shell ${recipe&&mode==='cook'?'cooking-shell':''}`}><a className="skip-link" href="#main-content" onClick={e=>{e.preventDefault();document.getElementById('main-content')?.focus();}}>Skip to content</a><header className="app-header"><div className="header-inner"><a href="#/" className="brand" aria-label="Countertop home"><span className="brand-mark"><CookingPot size={27} strokeWidth={1.4}/></span><div><strong>countertop<span>.</span></strong><small>A PLACE FOR GOOD FOOD</small></div></a><nav className="desktop-nav" aria-label="Main navigation">{nav.map(({id,label,path,Icon})=><a key={id} className={active===id?'active':''} href={`#${path}`} aria-current={active===id?'page':undefined}><Icon size={17}/>{label}{id==='shopping'&&selections.length>0&&<span className="nav-count">{selections.length}</span>}</a>)}</nav><div className="header-actions"><SyncButton open={()=>navigate('/settings/sync')}/><button className="btn-icon theme-toggle" aria-label="Toggle light or dark theme" onClick={()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark')}>{resolvedTheme==='dark'?<Sun size={20}/>:<Moon size={19}/>}</button><button className="btn btn-header" onClick={()=>navigate('/settings')}><Upload size={16}/><span>Import recipe</span></button></div></div></header>{warning&&<div className="storage-warning" role="status"><AlertCircle size={18}/><span>{warning}</span><button onClick={()=>navigate('/settings')}>Back up recipes</button></div>}<main id="main-content" tabIndex={-1} className="main-content">{active==='shopping'?(parts[2]==='timing'?<><a href="#/shopping" className="dinner-return"><ArrowLeft size={17}/> Back to shopping list</a><DinnerTimeline recipes={recipes} selections={selections} onOpenRecipe={id=>navigate(`/recipe/${id}/cook`)}/></>:<ShoppingList recipes={recipes} selections={selections} shoppingNotes={shoppingNotes} setSelections={setSelections} onBrowse={()=>navigate('/')}/>):active==='settings'?<DataSettings restored={restored} onBackupExport={downloadFullBackup} onBackupRestore={applyFullBackup} recipes={recipes} setRecipes={setRecipes} theme={theme} setTheme={setTheme} onReset={()=>{void applyFullBackup(resetBackup()).then(()=>navigate('/')).catch(err=>reportStorageWarning(String(err)));}}/>:recipe?<RecipeDetail key={recipe.id} recipe={recipe} shoppingNote={(cookbook.shareNotes.includes(recipe.id)?cookbook.sharedNotes:cookbook.privateNotes)[recipe.id]??''} shared={cookbook.shareNotes.includes(recipe.id)} sharedReminder={cookbook.sharedNotes[recipe.id]} onShoppingNoteChange={async (note,expected)=>{const shared=cookbook.shareNotes.includes(recipe.id); await change(s=>{assertLibrary(s,cookbook);editNote(s,recipe.id,note,expected,shared);}); if(shared) afterSave();}} mode={mode} setMode={m=>navigate(`/recipe/${recipe.id}/${m}`)} servings={effectiveServings} setServings={s=>setRecipeServings(recipe.id,s)} favorite={favorites.includes(recipe.id)} toggleFavorite={()=>toggleFavorite(recipe.id)} onBack={()=>navigate('/')} inShopping={selections.some(s=>s.recipeId===recipe.id)} onShop={()=>setSelections(previous=>[...previous.filter(s=>s.recipeId!==recipe.id),{recipeId:recipe.id,servings:effectiveServings}])}/>:parts[1]==='recipe'?<div className="empty-state"><BookOpen size={36}/><h1>This recipe isn’t in your cookbook.</h1><p>It may have been removed. You can restore it from a JSON backup.</p><button className="btn btn-primary" onClick={()=>navigate('/')}>Back to library</button></div>:<Library recipes={recipes} favorites={favorites} toggleFavorite={toggleFavorite} onOpen={id=>navigate(`/recipe/${id}/overview`)} onResume={id=>navigate(`/recipe/${id}/cook`)} onImport={()=>navigate('/settings')}/>}</main><footer className="app-footer"><span>countertop.</span><p>Your recipes. Your rhythm. Your kitchen.</p><small>Made for the everyday · v0.1</small></footer><nav className="mobile-nav" aria-label="Mobile navigation">{nav.map(({id,label,path,Icon})=><a key={id} className={active===id?'active':''} href={`#${path}`} aria-current={active===id?'page':undefined}><Icon size={21}/><span>{id==='settings'?'Settings':label}</span>{id==='shopping'&&selections.length>0&&<i>{selections.length}</i>}</a>)}</nav></div>;
}
