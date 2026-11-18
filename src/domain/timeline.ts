import type { CookingEvent } from './schema';

export function sortedEvents(events: CookingEvent[]): CookingEvent[] {
  return events.map((event, index) => ({event, index})).sort((a, b) => a.event.startMinute - b.event.startMinute || a.index - b.index).map(({event}) => event);
}

export function parallelEvents(events: CookingEvent[], event: CookingEvent): CookingEvent[] {
  const end = event.startMinute + (event.durationMinutes ?? 0);
  return events.filter((other) => other.id !== event.id && (other.startMinute === event.startMinute || (other.startMinute < end && other.startMinute + (other.durationMinutes ?? 0) > event.startMinute)));
}

export function formatMinute(minutes: number): string {
  const totalSeconds = Math.round(minutes * 60);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const label = `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')}`;
  return Number.isInteger(minutes) ? label : `${label}:${String(totalSeconds % 60).padStart(2, '0')}`;
}
