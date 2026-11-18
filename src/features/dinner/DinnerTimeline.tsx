import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, ChefHat, Check, Clock3, CookingPot, GitBranch, ListChecks, Thermometer, Utensils } from 'lucide-react';
import { z } from 'zod';
import type { Recipe } from '../../domain/schema';
import type { ShoppingSelection } from '../../domain/shopping';
import { createDinnerPlan, dinnerDateLabel, dinnerTimeLabel, MAX_DINNER_RECIPES, parseLocalDinnerTime, suggestDinnerTime, toLocalDinnerInput, type DinnerEvent } from '../../domain/dinner';
import { usePersistentState } from '../../storage/usePersistentState';
import './dinner.css';

type Props = {
  recipes: Recipe[];
  selections: ShoppingSelection[];
  onOpenRecipe: (id: string) => void;
};

const timingSchema = z.object({ serveAt: z.number().int().positive().max(253402300799999) });

export function DinnerTimeline({ recipes, selections, onOpenRecipe }: Props) {
  const [timing, setTiming] = usePersistentState('dinner-timing', timingSchema, () => ({ serveAt: suggestDinnerTime(recipes, selections) }));
  const [draftTime, setDraftTime] = useState(() => toLocalDinnerInput(timing.serveAt));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now);
  const plan = useMemo(() => createDinnerPlan(recipes, selections, timing.serveAt), [recipes, selections, timing.serveAt]);
  const eventLookup = useMemo(() => new Map(plan.events.map((event) => [event.key, event])), [plan.events]);
  const groups = useMemo(() => {
    const byDate = new Map<string, DinnerEvent[]>();
    for (const event of plan.events) {
      const date = dinnerDateLabel(event.startAt);
      const existing = byDate.get(date);
      if (existing) existing.push(event);
      else byDate.set(date, [event]);
    }
    return [...byDate.entries()];
  }, [plan.events]);
  const pastStarts = plan.recipes.filter((recipe) => recipe.startAt < now);
  const extendsPastServing = plan.events.filter((event) => event.endAt > timing.serveAt);
  const draftChanged = draftTime !== toLocalDinnerInput(timing.serveAt);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone.replaceAll('_', ' ');

  useEffect(() => {
    const update = () => setNow(Date.now());
    const interval = window.setInterval(update, 30_000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', update); };
  }, []);

  function applyTime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const serveAt = parseLocalDinnerTime(draftTime);
    if (serveAt === null || !timingSchema.safeParse({ serveAt }).success) {
      setError('Choose a complete, valid date and time. A time skipped by daylight saving cannot be used.');
      return;
    }
    setTiming({ serveAt }); setNow(Date.now()); setError('');
    setNotice(`Timing updated for ${dinnerDateLabel(serveAt)} at ${dinnerTimeLabel(serveAt)}.`);
  }

  function useSuggestedTime() {
    const serveAt = suggestDinnerTime(recipes, selections);
    setTiming({ serveAt }); setDraftTime(toLocalDinnerInput(serveAt)); setNow(Date.now()); setError('');
    setNotice(`Serving time moved to ${dinnerTimeLabel(serveAt)} on ${dinnerDateLabel(serveAt)}, allowing time for your longest recipe.`);
  }

  return <div className="dinner-page">
    <header className="dinner-heading">
      <p className="eyebrow">A LITTLE COORDINATION, A CALMER KITCHEN</p>
      <h1>Everything, to the table.</h1>
      <p>One serving time. A clear place to start each recipe on your shopping-list menu.</p>
    </header>

    {plan.limitExceeded ? <section className="dinner-empty" aria-labelledby="dinner-limit-title">
      <CookingPot size={36} strokeWidth={1.3} />
      <h2 id="dinner-limit-title">A smaller menu for this dinner.</h2>
      <p>Your shopping list has {plan.selectedRecipeCount} recipes. Dinner timing supports up to {MAX_DINNER_RECIPES} recipes at once. Remove some recipes from the shopping menu to build a complete timing plan.</p>
      <a className="btn btn-primary" href="#/shopping">Adjust shopping menu <ArrowRight size={17} /></a>
    </section> : plan.recipes.length === 0 ? <section className="dinner-empty">
      <CookingPot size={36} strokeWidth={1.3} />
      <h2>First, decide what’s for dinner.</h2>
      <p>Add recipes to your shopping list, then come back to bring their cooking timelines together.</p>
      <a className="btn btn-primary" href="#/shopping">Go to shopping list <ArrowRight size={17} /></a>
    </section> : <>
      <section className="dinner-target" aria-labelledby="dinner-target-title">
        <div className="dinner-target-copy"><span className="dinner-section-icon"><Utensils size={22} strokeWidth={1.4} /></span><div><p className="eyebrow">AT THE TABLE</p><h2 id="dinner-target-title">When would you like to eat?</h2><p>We’ll work backwards from your recipes’ estimated total times.</p></div></div>
        <form className="dinner-time-form" onSubmit={applyTime} noValidate>
          <label htmlFor="dinner-serve-at">Serving date & time</label>
          <div className="dinner-time-input-row"><input id="dinner-serve-at" type="datetime-local" min="1970-01-01T00:01" max="9999-12-31T23:59" step="60" required value={draftTime} onChange={(event) => { setDraftTime(event.target.value); setError(''); setNotice(''); }} aria-invalid={Boolean(error)} aria-describedby={error ? 'dinner-time-help dinner-time-error' : 'dinner-time-help'} /><button className="btn btn-primary" type="submit">Apply time <Check size={16} /></button></div>
          <p id="dinner-time-help">Local time · {timeZone}{draftChanged ? ' · Apply to update your plan.' : ''}</p>
          {error && <p className="dinner-error" id="dinner-time-error" role="alert">{error}</p>}
        </form>
      </section>
      <p className="dinner-status" role="status">{notice}</p>

      {pastStarts.length > 0 && <aside className="dinner-past-note" aria-label="Timing needs a look"><AlertCircle size={20} /><div><strong>{timing.serveAt < now ? 'This serving time has passed.' : `${pastStarts.length === 1 ? 'One recipe’s start time has' : `${pastStarts.length} recipe start times have`} already passed.`}</strong><p>{timing.serveAt < now ? 'Choose a new serving time when you’re ready to cook.' : 'If you haven’t begun, give yourself more time. If you’re already cooking, use the plan as a guide from here.'}</p><button className="btn btn-secondary" onClick={useSuggestedTime}>Use next available serving time <ArrowRight size={15} /></button></div></aside>}

      <section className="dinner-starts" aria-labelledby="dinner-starts-title">
        <div className="dinner-section-heading"><div><p className="eyebrow">YOUR STARTING POINTS</p><h2 id="dinner-starts-title">A little head start for each dish.</h2></div><span>{plan.recipes.length} {plan.recipes.length === 1 ? 'recipe' : 'recipes'} · one dinner</span></div>
        <div className="dinner-recipe-grid">{plan.recipes.map(({ recipe, servings, startAt }, index) => <article className={`dinner-recipe dinner-color-${index % 4}`} key={recipe.id}>
          <div className="dinner-recipe-top"><span className="dinner-recipe-number">{String(index + 1).padStart(2, '0')}</span><span>{servings} servings · {recipe.totalMinutes} min</span></div>
          <h3>{recipe.name}</h3><p className="dinner-start-label">Start cooking</p><time dateTime={new Date(startAt).toISOString()}><strong>{dinnerTimeLabel(startAt)}</strong><span>{dinnerDateLabel(startAt)}</span></time>
          <button className="btn dinner-open-recipe" onClick={() => onOpenRecipe(recipe.id)}><ChefHat size={16} />Open cooking view <ArrowRight size={16} /></button>
        </article>)}</div>
        <p className="dinner-scaling-note">Servings come from your shopping list. Changing portions adjusts ingredients; cooking times and temperatures stay as written.</p>
      </section>

      <aside className="dinner-kitchen-note" aria-labelledby="dinner-kitchen-title"><CookingPot size={25} strokeWidth={1.3} /><div><h2 id="dinner-kitchen-title">Leave a little room in the kitchen.</h2><p>These times coordinate recipe estimates. Check oven temperatures, rack space, burners, and how many hands each overlapping step needs. Stagger dishes or move serving time when they can’t comfortably cook together.</p><div className="dinner-heat-settings">{plan.recipes.flatMap(({ recipe }) => {
        const temperatures = [...new Set(recipe.events.flatMap((event) => event.temperature ? [event.temperature.replace(/^Oven:\s*/i, '')] : []))];
        return temperatures.length ? [<p key={recipe.id}><strong>{recipe.name}</strong><span><Thermometer size={14} />{temperatures.join(' · ')}</span></p>] : [];
      })}</div><p className="dinner-doneness-note">Use the recipe’s doneness checks to decide when food is ready. A shared serving time is a goal, not a guarantee.</p></div></aside>

      {extendsPastServing.length > 0 && <p className="dinner-duration-note"><AlertCircle size={18} />{extendsPastServing.length} {extendsPastServing.length === 1 ? 'step has an estimated duration' : 'steps have estimated durations'} extending beyond the recipe’s total time. Review those steps before relying on this serving time.</p>}

      <section className="dinner-combined" aria-labelledby="dinner-combined-title">
        <div className="dinner-section-heading"><div><p className="eyebrow">THE WHOLE DINNER, IN ORDER</p><h2 id="dinner-combined-title">Your kitchen timeline.</h2></div><span><ListChecks size={16} />{plan.events.length} steps</span></div>
        <p className="dinner-timeline-help"><GitBranch size={16} />Overlapping activities stay together. Open any step for its instructions and doneness guidance.</p>
        {groups.map(([date, events], groupIndex) => <section className="dinner-day" aria-labelledby={`dinner-day-${groupIndex}`} key={date}><h3 id={`dinner-day-${groupIndex}`}>{date}</h3><ol>{events.map((entry) => <li className={`dinner-event dinner-color-${entry.recipeIndex % 4}`} key={entry.key}>
          <div className="dinner-event-time"><time dateTime={new Date(entry.startAt).toISOString()}>{dinnerTimeLabel(entry.startAt)}</time>{entry.event.approximate && <span>approx.</span>}</div>
          <article className="dinner-event-body"><div className="dinner-event-meta"><span className="dinner-event-recipe">{entry.recipeName}</span><span>{entry.event.track}</span>{entry.event.durationMinutes !== undefined && entry.event.durationMinutes > 0 && <span><Clock3 size={13} />{entry.event.durationMinutes} min</span>}</div><h4>{entry.event.title}</h4>
            {entry.event.temperature && <p className="dinner-temperature"><Thermometer size={14} />{entry.event.temperature}</p>}
            {entry.overlaps.length > 0 && <div className="dinner-overlap"><GitBranch size={14} /><p><strong>{entry.overlaps.length} overlapping {entry.overlaps.length === 1 ? 'activity' : 'activities'}</strong><span>{entry.overlaps.slice(0, 2).map((key) => { const other = eventLookup.get(key); return other ? `${other.recipeName}: ${other.event.title}` : ''; }).filter(Boolean).join(' · ')}{entry.overlaps.length > 2 ? ` · +${entry.overlaps.length - 2} more` : ''}</span></p></div>}
            <details className="dinner-step-details"><summary>Instructions & doneness<span className="dinner-visually-hidden"> for {entry.event.title}</span></summary><p>{entry.event.instruction}</p>{entry.event.doneness && <p className="dinner-doneness"><Thermometer size={16} /><strong>{entry.event.doneness}</strong></p>}</details>
          </article>
        </li>)}</ol></section>)}
        <footer className="dinner-finish"><Utensils size={26} strokeWidth={1.4} /><div><p className="eyebrow">THE MOMENT YOU’RE WORKING TOWARD</p><h3>Dinner at {dinnerTimeLabel(timing.serveAt)}.</h3><p>{dinnerDateLabel(timing.serveAt)} · Rest, finish, and serve as each recipe directs.</p></div></footer>
      </section>
    </>}
  </div>;
}
