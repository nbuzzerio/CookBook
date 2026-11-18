export type ScreenAwakeStatus = 'off' | 'requesting' | 'active' | 'waiting' | 'released' | 'blocked' | 'unavailable';
export interface ScreenAwakeState { enabled: boolean; status: ScreenAwakeStatus }
export interface ScreenLock {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}
interface Options {
  request?: () => Promise<ScreenLock>;
  isVisible: () => boolean;
  onChange: (state: ScreenAwakeState) => void;
}

/** Owns the lock even if an in-flight browser request resolves after leaving Cook. */
export function createScreenAwakeController({ request, isVisible, onChange }: Options) {
  let enabled = false;
  let disposed = false;
  let generation = 0;
  let pending = false;
  let lock: ScreenLock | null = null;
  const publish = (status: ScreenAwakeStatus) => { if (!disposed) onChange({ enabled, status }); };
  const release = () => {
    const previous = lock;
    lock = null;
    if (previous && !previous.released) void previous.release().catch(() => undefined);
  };

  async function acquire() {
    if (!enabled || disposed || pending || lock) return;
    if (!request) { enabled = false; publish('unavailable'); return; }
    if (!isVisible()) { publish('waiting'); return; }
    const current = ++generation;
    pending = true;
    publish('requesting');
    try {
      const obtained = await request();
      if (disposed || !enabled || current !== generation || !isVisible()) {
        if (!obtained.released) await obtained.release().catch(() => undefined);
        return;
      }
      lock = obtained.released ? null : obtained;
      obtained.addEventListener('release', () => {
        if (lock !== obtained) return;
        lock = null;
        publish(enabled ? (isVisible() ? 'released' : 'waiting') : 'off');
      });
      publish(obtained.released ? 'released' : 'active');
    } catch {
      if (current === generation && !disposed) { enabled = false; publish('blocked'); }
    } finally {
      if (current === generation) pending = false;
    }
  }

  return {
    async setEnabled(value: boolean) {
      enabled = value;
      if (!value) {
        generation += 1;
        pending = false;
        release();
        publish('off');
      } else await acquire();
    },
    visibilityChanged() {
      if (!enabled || disposed) return;
      if (!isVisible()) {
        generation += 1;
        pending = false;
        release();
        publish('waiting');
      } else void acquire();
    },
    dispose() {
      disposed = true;
      enabled = false;
      generation += 1;
      pending = false;
      release();
    },
  };
}
