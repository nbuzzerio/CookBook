import { useCallback, useEffect, useRef, useState } from 'react';
import { getRemainingMs, type TimerState } from '../../domain/timers';
import { createScreenAwakeController, type ScreenAwakeState } from './wakeLock';

export function useScreenAwake() {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [state, setState] = useState<ScreenAwakeState>({ enabled: false, status: supported ? 'off' : 'unavailable' });
  const controller = useRef<ReturnType<typeof createScreenAwakeController> | null>(null);
  useEffect(() => {
    const current = createScreenAwakeController({
      request: supported ? () => navigator.wakeLock.request('screen') : undefined,
      isVisible: () => document.visibilityState === 'visible',
      onChange: setState,
    });
    controller.current = current;
    const visibilityChanged = () => current.visibilityChanged();
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged);
      current.dispose();
      controller.current = null;
    };
  }, [supported]);
  return { ...state, supported, toggle: () => void controller.current?.setEnabled(!state.enabled) };
}

/** Consume expiry transitions once; never replay timers that expired while hidden. */
export function collectNewExpirations(armed: Set<string>, timers: Record<string, TimerState>, now: number, visible: boolean): string[] {
  if (!visible) { armed.clear(); return []; }
  const expired: string[] = [];
  for (const id of armed) if (!timers[id]) armed.delete(id);
  for (const [id, timer] of Object.entries(timers)) {
    if (timer.status === 'running' && getRemainingMs(timer, now) > 0) armed.add(id);
    else {
      if (timer.status === 'running' && armed.has(id)) expired.push(id);
      armed.delete(id);
    }
  }
  return expired;
}

function playChime(context: AudioContext) {
  if (context.state !== 'running') return;
  [659.25, 880].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + index * .18;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(.12, start + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, start + .48);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + .5);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}

export function useTimerSound(timers: Record<string, TimerState>, now: number) {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('Sound is off. Enable it for a gentle timer chime.');
  const context = useRef<AudioContext | null>(null);
  const armed = useRef(new Set<string>());
  const mounted = useRef(true);
  const requestId = useRef(0);
  const supported = typeof window !== 'undefined' && typeof window.AudioContext !== 'undefined';

  useEffect(() => {
    mounted.current = true;
    const visibilityChanged = () => { if (document.visibilityState !== 'visible') armed.current.clear(); };
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      mounted.current = false;
      requestId.current += 1;
      document.removeEventListener('visibilitychange', visibilityChanged);
      if (context.current) void context.current.close().catch(() => undefined);
      context.current = null;
    };
  }, []);

  useEffect(() => {
    const expired = collectNewExpirations(armed.current, timers, now, document.visibilityState === 'visible');
    if (!expired.length || !enabled || !context.current) return;
    if (context.current.state !== 'running') {
      setEnabled(false);
      setMessage('Your browser paused audio. Enable sound again to hear future timers.');
      return;
    }
    try { playChime(context.current); }
    catch { setEnabled(false); setMessage('Timer sound is unavailable. Finished timers remain visible.'); }
  }, [timers, now, enabled]);

  const toggle = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (enabled) {
      setEnabled(false);
      setMessage('Sound is off. Enable it for a gentle timer chime.');
      if (context.current) void context.current.close().catch(() => undefined);
      context.current = null;
      return;
    }
    if (!supported) { setMessage('Timer sound is not supported by this browser.'); return; }
    try {
      const audio = context.current?.state !== 'closed' && context.current ? context.current : new AudioContext();
      context.current = audio;
      await audio.resume();
      if (!mounted.current || currentRequest !== requestId.current) return;
      if (audio.state !== 'running') throw new Error('Audio did not start');
      setEnabled(true);
      setMessage('Sound is on for this cooking view. Keep the page open and device volume audible.');
    } catch {
      if (mounted.current && currentRequest === requestId.current) {
        setEnabled(false);
        setMessage('Your browser could not enable sound. You can try again.');
      }
    }
  }, [enabled, supported]);

  return { enabled, supported, message, toggle };
}
