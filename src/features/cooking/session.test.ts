import { describe, expect, it } from 'vitest';
import { createTimer, getRemainingMs, startTimer } from '../../domain/timers';
import { elapsedTime, freshSession, sessionSchema, toggleCompletedStep, toggleSessionClock } from './session';

describe('persistent cooking sessions', () => {
  it('recovers elapsed time from the original timestamp after refresh or a throttled tab', () => {
    const running = toggleSessionClock(freshSession('lentils'), 1000);
    const restored = sessionSchema.parse(JSON.parse(JSON.stringify(running)));
    expect(elapsedTime(restored, 121_000)).toBe(120_000);
    expect(elapsedTime(restored, 500)).toBe(0);
  });

  it('excludes time spent paused across several pause/resume cycles', () => {
    const running = toggleSessionClock(freshSession('lentils'), 1000);
    const paused = toggleSessionClock(running, 61_000);
    expect(elapsedTime(paused, 361_000)).toBe(60_000);
    const resumed = toggleSessionClock(paused, 361_000);
    expect(elapsedTime(resumed, 421_000)).toBe(120_000);
    const pausedAgain = toggleSessionClock(resumed, 421_000);
    expect(elapsedTime(pausedAgain, 999_000)).toBe(120_000);
  });

  it('keeps independent timers running while the session clock is paused', () => {
    const running = {
      ...toggleSessionClock(freshSession('lentils'), 1000),
      timers: { lentils: startTimer(createTimer(300_000), 1000) },
    };
    const paused = toggleSessionClock(running, 61_000);
    expect(elapsedTime(paused, 121_000)).toBe(60_000);
    expect(getRemainingMs(paused.timers.lentils, 121_000)).toBe(180_000);
  });

  it('allows parallel steps in any order and stops the clock only when every step is complete', () => {
    const running = toggleSessionClock(freshSession('lentils'), 1000);
    const first = toggleCompletedStep(running, 'mushrooms', ['lentils', 'mushrooms'], 31_000);
    expect(first.status).toBe('running');
    const finished = toggleCompletedStep(first, 'lentils', ['lentils', 'mushrooms'], 61_000);
    expect(finished.status).toBe('paused');
    expect(elapsedTime(finished, 121_000)).toBe(60_000);
    expect(finished.completedIds).toEqual(['mushrooms', 'lentils']);
    const undone = toggleCompletedStep(finished, 'mushrooms', ['lentils', 'mushrooms'], 121_000);
    expect(undone.completedIds).toEqual(['lentils']);
    expect(undone.status).toBe('paused');
    expect(running.completedIds).toEqual([]);
  });

  it('rejects a corrupt running session or invalid persisted timer state', () => {
    expect(sessionSchema.safeParse({ ...freshSession('lentils'), status: 'running' }).success).toBe(false);
    expect(sessionSchema.safeParse({ ...freshSession('lentils'), timers: { lentils: { ...createTimer(1000), remainingMs: 2000 } } }).success).toBe(false);
  });
});
