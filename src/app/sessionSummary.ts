import type { Recipe } from '../domain/schema';
import { getRemainingMs } from '../domain/timers';
import { elapsedTime, type CookingSession } from '../features/cooking/session';

export function summarizeSession(recipe: Recipe, session: CookingSession, now: number) {
  const completed = recipe.events.filter(event => session.completedIds.includes(event.id)).length;
  const timers = recipe.events.flatMap(event => {
    const timer = session.timers[event.id];
    return timer && timer.status !== 'idle' ? [{ ...timer, remaining: getRemainingMs(timer, now) }] : [];
  });
  const finishedTimers = timers.filter(timer => timer.remaining === 0).length;
  const runningTimers = timers.filter(timer => timer.status === 'running' && timer.remaining > 0);
  return {
    active: timers.length > 0 || (completed < recipe.events.length && (session.status !== 'idle' || completed > 0)),
    completed,
    elapsed: elapsedTime(session, now),
    finishedTimers,
    nextTimerMs: runningTimers.length ? Math.min(...runningTimers.map(timer => timer.remaining)) : null,
    pausedTimers: timers.filter(timer => timer.status === 'paused' && timer.remaining > 0).length,
  };
}
