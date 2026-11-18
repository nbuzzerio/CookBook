import { z } from 'zod';

export const timerSchema = z.object({
  durationMs: z.number().finite().positive().max(604800000),
  remainingMs: z.number().finite().min(0).max(604800000),
  startedAt: z.number().finite().nonnegative().nullable(),
  status: z.enum(['idle', 'running', 'paused', 'finished']),
}).refine((timer) => timer.remainingMs <= timer.durationMs, 'Remaining time cannot exceed timer duration').refine((timer) => timer.status !== 'running' || timer.startedAt !== null, 'Running timers require a start timestamp');
export type TimerState = z.infer<typeof timerSchema>;

export function createTimer(durationMs: number): TimerState {
  return timerSchema.parse({durationMs, remainingMs: durationMs, startedAt: null, status: 'idle'});
}
export function getRemainingMs(timer: TimerState, now = Date.now()): number {
  if (timer.status === 'finished') return 0;
  const elapsed = timer.status === 'running' && timer.startedAt !== null ? Math.max(0, now - timer.startedAt) : 0;
  return Math.max(0, timer.remainingMs - elapsed);
}
export const timerRemaining = getRemainingMs;
export function startTimer(timer: TimerState, now = Date.now()): TimerState {
  if (timer.status === 'running') return synchronizeTimer(timer, now);
  if (timer.status === 'finished' || timer.remainingMs <= 0) return {...timer, remainingMs: 0, startedAt: null, status: 'finished'};
  return {...timer, startedAt: now, status: 'running'};
}
export function pauseTimer(timer: TimerState, now = Date.now()): TimerState {
  const remainingMs = getRemainingMs(timer, now);
  return {...timer, remainingMs, startedAt: null, status: remainingMs <= 0 ? 'finished' : timer.status === 'idle' ? 'idle' : 'paused'};
}
export function resetTimer(timer: TimerState): TimerState { return createTimer(timer.durationMs); }
export function synchronizeTimer(timer: TimerState, now = Date.now()): TimerState {
  return timer.status === 'running' && getRemainingMs(timer, now) === 0 ? {...timer, remainingMs: 0, startedAt: null, status: 'finished'} : timer;
}
export function formatTimer(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
