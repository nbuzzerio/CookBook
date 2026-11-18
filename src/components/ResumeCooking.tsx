import { useEffect, useState } from 'react';
import { ArrowRight, Flame, Pause, Timer } from 'lucide-react';
import type { Recipe } from '../domain/schema';
import { formatTimer } from '../domain/timers';
import { freshSession, sessionSchema, type CookingSession } from '../features/cooking/session';
import { summarizeSession } from '../app/sessionSummary';
import { readStored } from '../storage/persistence';
import './resume-cooking.css';

export function ResumeCooking({ recipes, onResume }: { recipes: Recipe[]; onResume: (id: string) => void }) {
  const [sessions,setSessions] = useState<{recipe:Recipe;session:CookingSession}[]>([]);
  const [now,setNow] = useState(Date.now);
  const [expanded,setExpanded] = useState(false);
  useEffect(()=>{
    setSessions(recipes.map(recipe=>({recipe,session:readStored(`session:${recipe.id}`,sessionSchema,freshSession(recipe.events[0].id))})));
    setNow(Date.now());
  },[recipes]);
  const active = sessions.map(entry=>({...entry,summary:summarizeSession(entry.recipe,entry.session,now)})).filter(entry=>entry.summary.active);
  const needsClock = active.some(entry=>entry.session.status==='running'||entry.summary.nextTimerMs!==null);
  useEffect(()=>{
    if(!needsClock)return;
    const update=()=>setNow(Date.now());
    const interval=window.setInterval(update,1000);
    document.addEventListener('visibilitychange',update);
    return ()=>{window.clearInterval(interval);document.removeEventListener('visibilitychange',update);};
  },[needsClock]);
  if(!active.length)return null;
  return <section className="resume-cooking" aria-labelledby="resume-heading">
    <div className="resume-heading"><div><p className="eyebrow"><Flame size={15}/> BACK TO THE KITCHEN</p><h2 id="resume-heading">Pick up where you left off.</h2></div><span>{active.length} {active.length===1?'cooking session':'cooking sessions'}</span></div>
    <div className="resume-cards">{(expanded?active:active.slice(0,3)).map(({recipe,session,summary})=><button className={`resume-card ${summary.finishedTimers?'has-finished-timer':''}`} key={recipe.id} onClick={()=>onResume(recipe.id)} aria-label={`Resume cooking ${recipe.name}`}>
      <span className="resume-card-copy"><strong>{recipe.name}</strong><span>{session.status==='running'?'Cooking':session.status==='paused'?'Paused':'In progress'} · {summary.completed} of {recipe.events.length} steps complete</span>
        {summary.finishedTimers>0?<small className="resume-timer-finished"><Timer size={14}/>{summary.finishedTimers} {summary.finishedTimers===1?'timer finished':'timers finished'} — check your food</small>:summary.nextTimerMs!==null?<small><Timer size={14}/>{formatTimer(summary.nextTimerMs)} until the next timer</small>:summary.pausedTimers>0?<small><Pause size={14}/>{summary.pausedTimers} {summary.pausedTimers===1?'timer paused':'timers paused'}</small>:null}
      </span><ArrowRight size={19}/>
    </button>)}</div>
    {active.length>3&&<button className="text-button" onClick={()=>setExpanded(!expanded)}>{expanded?'Show fewer sessions':`Show all ${active.length} sessions`}</button>}
  </section>;
}
