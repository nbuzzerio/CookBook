import { getRemainingMs, type TimerState } from '../../domain/timers';

/** A finished timer gets a paused minute, so adding time never starts it silently. */
export function extendTimerByMinute(timer: TimerState, now: number): TimerState {
  const durationMs = Math.min(604_800_000, timer.durationMs + 60_000);
  const remainingMs = Math.min(durationMs, getRemainingMs(timer, now) + 60_000);
  const running = timer.status === 'running' && getRemainingMs(timer, now) > 0;
  return { durationMs, remainingMs, startedAt: running ? now : null, status: running ? 'running' : 'paused' };
}
