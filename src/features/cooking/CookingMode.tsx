import { useEffect, useMemo, useState } from 'react';
import { Check, CheckCheck, ChevronRight, Circle, Clock3, Flame, ListChecks, Maximize2, Minimize2, Monitor, Pause, Play, Plus, RotateCcw, Timer, TimerReset, Utensils, Volume2, VolumeX, Waves } from 'lucide-react';
import type { Recipe } from '../../domain/schema';
import { createTimer, getRemainingMs, pauseTimer, startTimer, synchronizeTimer, type TimerState } from '../../domain/timers';
import { formatMinute as relativeTime } from '../../domain/timeline';
import { usePersistentState } from '../../storage/usePersistentState';
import { elapsedTime, freshSession, sessionSchema, toggleCompletedStep, toggleSessionClock } from './session';
import { useScreenAwake, useTimerSound } from './useCookingTools';
import { extendTimerByMinute } from './timerExtension';
import './cooking.css';

function clockTime(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function CookingMode({ recipe }: { recipe: Recipe }) {
  const events = useMemo(() => [...recipe.events].sort((a, b) => a.startMinute - b.startMinute), [recipe.events]);
  const [session, setSession] = usePersistentState(`session:${recipe.id}`, sessionSchema, () => freshSession(events[0]?.id ?? ''));
  const [now, setNow] = useState(() => Date.now());
  const [focused, setFocused] = useState(false);
  const screenAwake = useScreenAwake();
  const sound = useTimerSound(session.timers, now);
  const runningTimers = Object.values(session.timers).some(timer => timer.status === 'running');
  const clockRunning = session.status === 'running' || runningTimers;

  useEffect(() => {
    if (!focused) return;
    const exitOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setFocused(false); };
    document.addEventListener('keydown', exitOnEscape);
    return () => document.removeEventListener('keydown', exitOnEscape);
  }, [focused]);

  useEffect(() => {
    if (!clockRunning) return;
    const update = () => setNow(Date.now());
    const interval = window.setInterval(update, 500);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
    };
  }, [clockRunning]);

  useEffect(() => {
    const expired = Object.entries(session.timers).filter(([, timer]) => timer.status === 'running' && getRemainingMs(timer, now) === 0);
    if (!expired.length) return;
    setSession(current => ({
      ...current,
      timers: Object.fromEntries(Object.entries(current.timers).map(([id, timer]) => [id, synchronizeTimer(timer, now)])),
    }));
  }, [now, session.timers, setSession]);

  const elapsed = elapsedTime(session, now);
  const elapsedMinutes = elapsed / 60_000;
  const selected = events.find(event => event.id === session.selectedId) ?? events[0];
  const completed = events.filter(event => session.completedIds.includes(event.id)).length;
  const allDone = completed === events.length && events.length > 0;
  const due = events.filter(event => event.startMinute <= elapsedMinutes && !session.completedIds.includes(event.id));
  const upcoming = events.filter(event => event.startMinute > elapsedMinutes && !session.completedIds.includes(event.id));
  const liveTimers = events.filter(event => {
    const timer = session.timers[event.id];
    return timer && timer.status !== 'idle';
  });
  const selectedIndex = events.findIndex(event => event.id === selected?.id);

  function toggleSession() {
    const timestamp = Date.now();
    setNow(timestamp);
    setSession(current => toggleSessionClock(current, timestamp));
  }

  function resetSession() {
    const hasProgress = session.status !== 'idle' || session.completedIds.length > 0 || Object.values(session.timers).some(timer => timer.status !== 'idle');
    if (hasProgress && !window.confirm('Reset this cooking session? Elapsed time, completed steps, and all cooking timers for this recipe will be cleared. Your ingredient checklist and shopping list will stay as they are.')) return;
    setNow(Date.now());
    setSession(freshSession(events[0]?.id ?? ''));
  }

  function updateTimer(eventId: string, operation: 'start' | 'pause' | 'reset' | 'extend') {
    const event = events.find(item => item.id === eventId);
    if (!event?.timerMinutes) return;
    const timestamp = Date.now();
    setNow(timestamp);
    setSession(current => {
      const timer = current.timers[eventId] ?? createTimer(event.timerMinutes! * 60_000);
      const next = operation === 'extend' ? extendTimerByMinute(timer, timestamp) : operation === 'start' ? startTimer(getRemainingMs(timer, timestamp) === 0 ? createTimer(event.timerMinutes! * 60_000) : timer, timestamp) : operation === 'pause' ? pauseTimer(timer, timestamp) : createTimer(event.timerMinutes! * 60_000);
      return { ...current, timers: { ...current.timers, [eventId]: next } };
    });
  }

  function toggleComplete(id: string) {
    const timestamp = Date.now();
    setSession(current => toggleCompletedStep(current, id, events.map(event => event.id), timestamp));
    setNow(timestamp);
  }

  function selectEvent(id: string) {
    setSession(current => ({ ...current, selectedId: id }));
  }

  function timerControls(eventId: string, timer: TimerState, compact = false) {
    const remaining = getRemainingMs(timer, now);
    const finished = remaining === 0 && timer.status !== 'idle';
    return (
      <div className={`cook-timer-controls ${compact ? 'is-compact' : ''}`}>
        <div className={`cook-timer-reading ${finished ? 'is-finished' : ''}`}>
          <Timer size={compact ? 18 : 22} aria-hidden="true" />
          <span className="cook-digits" aria-label={finished ? 'Timer finished' : `${clockTime(remaining)} remaining`}>{finished ? 'Time’s up' : clockTime(remaining)}</span>
          {!compact && <span className="cook-timer-state">{finished ? 'Check your food' : timer.status === 'idle' ? 'Ready when you are' : timer.status === 'paused' ? 'Paused' : 'Remaining'}</span>}
        </div>
        <div className="cook-control-row">
          {timer.status === 'running' && !finished ? (
            <button className="btn btn-secondary" onClick={() => updateTimer(eventId, 'pause')} aria-label={`Pause timer for ${events.find(event => event.id === eventId)?.title}`}><Pause size={16} aria-hidden="true" />{!compact && 'Pause'}</button>
          ) : (
            <button className={`btn ${compact ? 'btn-secondary' : 'btn-primary'}`} onClick={() => updateTimer(eventId, 'start')} aria-label={`${timer.status === 'paused' ? 'Resume' : finished ? 'Restart' : 'Start'} timer for ${events.find(event => event.id === eventId)?.title}`}><Play size={16} aria-hidden="true" />{!compact && (timer.status === 'paused' ? 'Resume timer' : finished ? 'Restart timer' : 'Start timer')}</button>
          )}
          {timer.status !== 'idle' && <button className="btn btn-secondary" onClick={() => updateTimer(eventId, 'reset')} aria-label={`Reset timer for ${events.find(event => event.id === eventId)?.title}`}><TimerReset size={17} aria-hidden="true" />{!compact && 'Reset'}</button>}
          {!compact && timer.status !== 'idle' && <button className="btn btn-secondary" onClick={() => updateTimer(eventId, 'extend')} aria-label={`Add one minute to timer for ${events.find(event => event.id === eventId)?.title}`}><Plus size={16} aria-hidden="true" />1 min</button>}
        </div>
      </div>
    );
  }

  if (!selected) return <p>This recipe has no cooking steps.</p>;

  return (
    <section className={`cooking-mode ${focused ? 'is-focused' : ''}`} aria-label="Guided cooking session">
      <div className="cook-tools-bar">
        <div className="cook-tools-heading"><span className="eyebrow">{focused ? 'FOCUS MODE' : 'MAKE YOURSELF COMFORTABLE'}</span>{focused && <strong>{recipe.name}</strong>}</div>
        <div className="cook-tools-actions">
          <button className="btn btn-secondary" aria-pressed={focused} onClick={() => { setFocused(value => !value); window.scrollTo({ top: 0, behavior: 'instant' }); }}>{focused ? <Minimize2 size={17} aria-hidden="true" /> : <Maximize2 size={17} aria-hidden="true" />}{focused ? 'Exit focus' : 'Focus mode'}</button>
          <button className="btn btn-secondary" aria-pressed={screenAwake.enabled} aria-describedby="cook-screen-status" disabled={!screenAwake.supported} onClick={screenAwake.toggle}><Monitor size={17} aria-hidden="true" />{screenAwake.status === 'active' ? 'Screen stays awake' : screenAwake.status === 'requesting' ? 'Requesting screen…' : 'Keep screen awake'}</button>
          <button className="btn btn-secondary" aria-pressed={sound.enabled} aria-describedby="cook-sound-status" disabled={!sound.supported} onClick={() => void sound.toggle()}>{sound.enabled ? <Volume2 size={17} aria-hidden="true" /> : <VolumeX size={17} aria-hidden="true" />}{sound.enabled ? 'Timer sound on' : 'Enable timer sound'}</button>
        </div>
        <div className="cook-tools-status" aria-live="polite">
          <span id="cook-screen-status">{screenAwake.status === 'unavailable' ? 'Screen wake lock is unavailable in this browser or connection.' : screenAwake.status === 'blocked' ? 'Your browser did not allow screen wake lock. You can try again.' : screenAwake.status === 'active' ? 'The screen stays awake while this cooking view is visible.' : screenAwake.status === 'requesting' ? 'Asking your browser to keep the screen awake.' : screenAwake.status === 'waiting' ? 'Screen wake lock will be requested when you return to this page.' : screenAwake.status === 'released' ? 'The browser released the screen lock. Turn it off and on to retry.' : 'Screen wake lock is off.'}</span>
          <span id="cook-sound-status">{sound.supported ? sound.message : 'Timer sound is unavailable in this browser.'}</span>
        </div>
      </div>
      <div className="cook-session-bar">
        <div className="cook-session-title">
          <span className="cook-session-symbol"><Utensils size={23} aria-hidden="true" /></span>
          <div><span className="eyebrow">Your time in the kitchen</span><h2>{allDone ? 'Ready for the table.' : session.status === 'idle' ? 'Let’s make something good.' : session.status === 'paused' ? 'Take a little breather.' : 'One good step at a time.'}</h2></div>
        </div>
        <div className="cook-session-clock"><span className="cook-digits" role="timer" aria-label="Session elapsed time">{clockTime(elapsed)}</span><span>{session.status === 'running' ? 'Elapsed' : session.status === 'paused' ? 'Session paused' : 'Elapsed time'}</span></div>
        <div className="cook-control-row">
          {!allDone && <button className="btn btn-primary" onClick={toggleSession}>{session.status === 'running' ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}{session.status === 'running' ? 'Pause' : session.status === 'paused' ? 'Resume' : 'Begin cooking'}</button>}
          <button className="btn btn-secondary" onClick={resetSession} aria-label="Reset cooking session"><RotateCcw size={18} aria-hidden="true" /><span>Reset</span></button>
        </div>
      </div>

      <div className="cook-progress-row"><span><CheckCheck size={16} aria-hidden="true" /> {completed} of {events.length} steps complete</span><span>{Math.round(completed / events.length * 100)}%</span></div>
      <div className="cook-progress" role="progressbar" aria-label="Cooking steps complete" aria-valuemin={0} aria-valuemax={events.length} aria-valuenow={completed}><span style={{ width: `${completed / events.length * 100}%` }} /></div>

      {allDone && <div className="cook-finished-note" role="status"><CheckCheck size={22} aria-hidden="true" /><div><strong>Everything is checked off. Enjoy your meal.</strong><p>{recipe.servingInstructions}</p>{runningTimers && <p>Your remaining timers are still running below.</p>}</div></div>}

      {liveTimers.length > 0 && (
        <section className="cook-live-timers" aria-label="Your cooking timers">
          {liveTimers.map(event => {
            const timer = session.timers[event.id];
            const finished = getRemainingMs(timer, now) === 0;
            return <div key={event.id} className={`cook-live-timer ${finished ? 'is-finished' : ''}`}>
              <button className="cook-timer-jump" onClick={() => selectEvent(event.id)}><span className="eyebrow">{finished ? 'Timer finished' : timer.status === 'paused' ? 'Timer paused' : 'Timer running'}</span><strong>{event.title}</strong></button>
              {timerControls(event.id, timer, true)}
              {finished && <span className="sr-only" role="status">Timer finished: {event.title}. Check your food.</span>}
            </div>;
          })}
        </section>
      )}

      {session.status !== 'idle' && due.length > 1 && (
        <div className="cook-parallel-note"><Waves size={20} aria-hidden="true" /><div><strong>{due.length} activities are ready to work on</strong><p>Some tasks overlap. Choose the one that makes sense for your kitchen.</p><div className="cook-parallel-links">{due.filter(event => event.id !== selected.id).map(event => <button key={event.id} onClick={() => selectEvent(event.id)}>{event.title}<ChevronRight size={14} aria-hidden="true" /></button>)}</div></div></div>
      )}

      <div className="cook-workspace">
        <article className="cook-focus-card" aria-labelledby="cook-step-title">
          <div className="cook-step-meta"><span className="eyebrow">Step {String(selectedIndex + 1).padStart(2, '0')}</span><span className="cook-track">{selected.track}</span></div>
          <h3 id="cook-step-title">{selected.title}</h3>
          <div className="cook-step-time"><Clock3 size={16} aria-hidden="true" /><span>{selected.approximate ? 'Around' : 'Planned at'} +{relativeTime(selected.startMinute)}</span>{selected.durationMinutes && <><span className="cook-time-divider">·</span><span>{selected.durationMinutes} min</span></>}</div>
          <div className="cook-instructions">{selected.instruction.split('\n').filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
          {(selected.temperature || selected.doneness) && <div className="cook-doneness"><Flame size={21} aria-hidden="true" /><div>{selected.temperature && <strong>{selected.temperature}</strong>}{selected.doneness && <p>{selected.doneness}</p>}</div></div>}
          {selected.timerMinutes && <div className="cook-step-timer"><span className="eyebrow">A little help keeping time · {selected.timerMinutes} min</span>{timerControls(selected.id, session.timers[selected.id] ?? createTimer(selected.timerMinutes * 60_000))}</div>}
          <div className="cook-step-footer"><button className={`btn ${session.completedIds.includes(selected.id) ? 'btn-secondary cook-complete-button' : 'btn-primary'}`} onClick={() => toggleComplete(selected.id)} aria-pressed={session.completedIds.includes(selected.id)}><Check size={18} aria-hidden="true" />{session.completedIds.includes(selected.id) ? 'Completed · undo' : 'Mark step complete'}</button>{selectedIndex < events.length - 1 && <button className="btn btn-secondary" onClick={() => selectEvent(events[selectedIndex + 1].id)}>Next step <ChevronRight size={17} aria-hidden="true" /></button>}</div>
        </article>

        <aside className="cook-step-list" aria-label="All cooking steps">
          <div className="cook-list-heading"><ListChecks size={19} aria-hidden="true" /><h3>The whole picture</h3><span>{events.length} steps</span></div>
          <p className="cook-list-caption">Jump to any step. Work at your own pace.</p>
          <ol>{events.map((event, index) => {
            const done = session.completedIds.includes(event.id);
            const isDue = session.status !== 'idle' && event.startMinute <= elapsedMinutes && !done;
            return <li key={event.id}><button className={`cook-step-link ${selected.id === event.id ? 'is-selected' : ''} ${done ? 'is-complete' : ''}`} onClick={() => selectEvent(event.id)} aria-current={selected.id === event.id ? 'step' : undefined}>
              <span className="cook-step-number">{done ? <Check size={16} aria-hidden="true" /> : String(index + 1).padStart(2, '0')}</span><span className="cook-step-link-text"><strong>{event.title}</strong><small>{event.track}<span> · </span>{done ? 'Complete' : isDue ? 'Ready now' : `+${relativeTime(event.startMinute)}`}</small></span>{isDue && <Circle className="cook-due-dot" size={8} fill="currentColor" aria-label="Ready now" />}
            </button></li>;
          })}</ol>
        </aside>
      </div>

      {upcoming.length > 0 && session.status !== 'idle' && <div className="cook-next-up"><span className="eyebrow">Coming up · +{relativeTime(upcoming[0].startMinute)}</span><button onClick={() => selectEvent(upcoming[0].id)}>{upcoming[0].title}<ChevronRight size={17} aria-hidden="true" /></button></div>}
      <p className="cook-footnote">The timeline is a guide; check doneness as you go. Timers run independently when the session is paused. Progress is saved in this browser, but alerts cannot be relied on after the browser closes.</p>
    </section>
  );
}
