/** Recovery signals are hints to retry failed links, never proof a server is reachable. */
export interface RecoveryEnvironment {
  window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  document: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & { readonly visibilityState: string };
  now(): number;
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(timer: unknown): void;
}

const CHECK_INTERVAL_MS = 10_000;
export const RESUME_GAP_MS = 30_000;

/** Install once at boot. A delayed timer also notices sleep with no focus transition. */
export function installConnectionRecovery(recover: () => void, env?: RecoveryEnvironment): () => void {
  const runtime: RecoveryEnvironment = env ?? {
    window,
    document,
    now: Date.now,
    setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
    clearInterval: (timer) => globalThis.clearInterval(timer as ReturnType<typeof setInterval>),
  };
  const visible = () => {
    if (runtime.document.visibilityState === 'visible') recover();
  };
  runtime.window.addEventListener('online', recover);
  runtime.window.addEventListener('focus', visible);
  runtime.document.addEventListener('visibilitychange', visible);
  let lastTick = runtime.now();
  const timer = runtime.setInterval(() => {
    const now = runtime.now();
    if (now - lastTick > RESUME_GAP_MS) recover();
    lastTick = now;
  }, CHECK_INTERVAL_MS);
  return () => {
    runtime.window.removeEventListener('online', recover);
    runtime.window.removeEventListener('focus', visible);
    runtime.document.removeEventListener('visibilitychange', visible);
    runtime.clearInterval(timer);
  };
}
