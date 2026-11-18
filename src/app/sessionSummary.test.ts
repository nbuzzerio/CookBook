import { describe, expect, it } from 'vitest';
import { sampleRecipes } from '../data';
import { createTimer, startTimer } from '../domain/timers';
import { freshSession } from '../features/cooking/session';
import { summarizeSession } from './sessionSummary';

const recipe = sampleRecipes[0];
const event = recipe.events[0];
describe('resume cooking summaries', () => {
  it('omits untouched and fully completed sessions without timers', () => {
    expect(summarizeSession(recipe, freshSession(event.id), 1000).active).toBe(false);
    expect(summarizeSession(recipe, { ...freshSession(event.id), status:'paused', completedIds:recipe.events.map(e=>e.id) }, 1000).active).toBe(false);
  });
  it('keeps unfinished checklist-only progress resumable', () => {
    expect(summarizeSession(recipe, { ...freshSession(event.id), completedIds:[event.id] }, 1000)).toMatchObject({active:true,completed:1});
  });
  it('derives running and finished timers while outside cooking mode', () => {
    const session = { ...freshSession(event.id), timers:{[event.id]:startTimer(createTimer(60000),1000)} };
    expect(summarizeSession(recipe,session,31000)).toMatchObject({active:true,nextTimerMs:30000,finishedTimers:0});
    expect(summarizeSession(recipe,session,61000)).toMatchObject({active:true,nextTimerMs:null,finishedTimers:1});
  });
  it('ignores stale timer and completion IDs that no longer belong to the recipe', () => {
    expect(summarizeSession(recipe,{...freshSession(event.id),completedIds:['missing'],timers:{missing:startTimer(createTimer(1000),0)}},2000)).toMatchObject({active:false,completed:0,finishedTimers:0});
  });
});
