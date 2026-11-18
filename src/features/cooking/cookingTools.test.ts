import { describe, expect, it, vi } from 'vitest';
import { createTimer, getRemainingMs, pauseTimer, startTimer, synchronizeTimer, timerSchema } from '../../domain/timers';
import { createScreenAwakeController, type ScreenAwakeState, type ScreenLock } from './wakeLock';
import { collectNewExpirations } from './useCookingTools';
import { extendTimerByMinute } from './timerExtension';

function fakeLock(): ScreenLock {
  let onRelease: (() => void) | undefined;
  const lock: ScreenLock = {
    released: false,
    release: vi.fn(async () => { lock.released = true; onRelease?.(); }),
    addEventListener: (_type, listener) => { onRelease = listener; },
  };
  return lock;
}

describe('screen-awake lifecycle', () => {
  it('acquires on explicit opt-in, releases on hiding, reacquires on return, and releases on exit', async () => {
    let visible = true;
    const first = fakeLock();
    const second = fakeLock();
    const request = vi.fn<() => Promise<ScreenLock>>().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const states: ScreenAwakeState[] = [];
    const controller = createScreenAwakeController({ request, isVisible: () => visible, onChange: state => states.push(state) });
    expect(request).not.toHaveBeenCalled();
    await controller.setEnabled(true);
    expect(states.at(-1)).toEqual({ enabled: true, status: 'active' });
    visible = false;
    controller.visibilityChanged();
    expect(first.release).toHaveBeenCalledOnce();
    expect(states.at(-1)?.status).toBe('waiting');
    visible = true;
    controller.visibilityChanged();
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.status).toBe('active');
    controller.dispose();
    expect(second.release).toHaveBeenCalledOnce();
  });

  it('releases a late browser request after the user switches off or leaves the view', async () => {
    for (const action of ['off', 'dispose']) {
      let resolve!: (lock: ScreenLock) => void;
      const obtained = fakeLock();
      const onChange = vi.fn();
      const controller = createScreenAwakeController({ request: () => new Promise(done => { resolve = done; }), isVisible: () => true, onChange });
      const pending = controller.setEnabled(true);
      if (action === 'off') await controller.setEnabled(false); else controller.dispose();
      const notifications = onChange.mock.calls.length;
      resolve(obtained);
      await pending;
      expect(obtained.release).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenCalledTimes(notifications);
    }
  });

  it('shows graceful unsupported and denied states instead of claiming a screen lock', async () => {
    const unsupportedStates = vi.fn();
    await createScreenAwakeController({ isVisible: () => true, onChange: unsupportedStates }).setEnabled(true);
    expect(unsupportedStates).toHaveBeenLastCalledWith({ enabled: false, status: 'unavailable' });
    const deniedStates = vi.fn();
    await createScreenAwakeController({ request: () => Promise.reject(new Error('Denied')), isVisible: () => true, onChange: deniedStates }).setEnabled(true);
    expect(deniedStates).toHaveBeenLastCalledWith({ enabled: false, status: 'blocked' });
  });

  it('reflects a browser-initiated release and does not loop trying to reacquire it', async () => {
    const obtained = fakeLock();
    const request = vi.fn(async () => obtained);
    const onChange = vi.fn();
    const controller = createScreenAwakeController({ request, isVisible: () => true, onChange });
    await controller.setEnabled(true);
    await obtained.release();
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, status: 'released' });
    expect(request).toHaveBeenCalledOnce();
    controller.dispose();
  });
});

describe('foreground timer chimes', () => {
  it('reports each newly expired timer once and can rearm a restarted timer', () => {
    const armed = new Set<string>();
    const timers = { pasta: startTimer(createTimer(1000), 100) };
    expect(collectNewExpirations(armed, timers, 500, true)).toEqual([]);
    expect(collectNewExpirations(armed, timers, 1100, true)).toEqual(['pasta']);
    expect(collectNewExpirations(armed, timers, 1200, true)).toEqual([]);
    const restarted = { pasta: startTimer(createTimer(1000), 1300) };
    collectNewExpirations(armed, restarted, 1500, true);
    expect(collectNewExpirations(armed, restarted, 2300, true)).toEqual(['pasta']);
  });

  it('does not replay an already expired timer after reload or returning from a hidden tab', () => {
    const armed = new Set<string>();
    const timers = { pasta: startTimer(createTimer(1000), 100) };
    expect(collectNewExpirations(armed, timers, 1200, true)).toEqual([]);
    collectNewExpirations(armed, timers, 500, true);
    collectNewExpirations(armed, timers, 600, false);
    expect(collectNewExpirations(armed, timers, 1200, true)).toEqual([]);
  });
});

describe('a little more cooking time', () => {
  it('adds a minute from actual remaining time without losing running elapsed time', () => {
    const running = startTimer(createTimer(120_000), 1000);
    const extended = extendTimerByMinute(running, 31_000);
    expect(extended.status).toBe('running');
    expect(getRemainingMs(extended, 61_000)).toBe(120_000);
    expect(timerSchema.safeParse(extended).success).toBe(true);
    expect(running.durationMs).toBe(120_000);
  });

  it('leaves paused timers paused and requires explicit resume for an expired timer', () => {
    const running = startTimer(createTimer(120_000), 1000);
    const paused = extendTimerByMinute(pauseTimer(running, 31_000), 61_000);
    expect(paused.status).toBe('paused');
    expect(getRemainingMs(paused, 999_000)).toBe(150_000);
    const finished = extendTimerByMinute(synchronizeTimer(running, 121_000), 181_000);
    expect(finished.status).toBe('paused');
    expect(finished.startedAt).toBeNull();
    expect(getRemainingMs(finished, 999_000)).toBe(60_000);
  });
});
