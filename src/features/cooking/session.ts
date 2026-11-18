import { z } from 'zod';
import { timerSchema } from '../../domain/timers';

export const sessionSchema = z.object({
  status: z.enum(['idle', 'running', 'paused']),
  accumulatedMs: z.number().finite().nonnegative(),
  startedAt: z.number().finite().nonnegative().nullable(),
  completedIds: z.array(z.string()),
  selectedId: z.string(),
  timers: z.record(z.string(), timerSchema),
}).refine(session => session.status !== 'running' || session.startedAt !== null, 'A running session needs its start timestamp');

export type CookingSession = z.infer<typeof sessionSchema>;

export function freshSession(firstId: string): CookingSession {
  return { status: 'idle', accumulatedMs: 0, startedAt: null, completedIds: [], selectedId: firstId, timers: {} };
}

export function elapsedTime(session: CookingSession, now: number): number {
  return session.accumulatedMs + (session.status === 'running' && session.startedAt !== null ? Math.max(0, now - session.startedAt) : 0);
}

export function toggleSessionClock(session: CookingSession, now: number): CookingSession {
  return session.status === 'running'
    ? { ...session, status: 'paused', accumulatedMs: elapsedTime(session, now), startedAt: null }
    : { ...session, status: 'running', startedAt: now };
}

export function toggleCompletedStep(session: CookingSession, id: string, eventIds: string[], now: number): CookingSession {
  const wasDone = session.completedIds.includes(id);
  const completedIds = wasDone ? session.completedIds.filter(item => item !== id) : [...session.completedIds, id];
  const finished = eventIds.every(eventId => completedIds.includes(eventId));
  return {
    ...session,
    completedIds,
    ...(finished ? { status: 'paused' as const, accumulatedMs: elapsedTime(session, now), startedAt: null } : {}),
  };
}
