import { afterEach, describe, expect, it, vi } from 'vitest';
import { installConnectionRecovery, RESUME_GAP_MS, type RecoveryEnvironment } from './connectionRecovery';

afterEach(() => vi.useRealTimers());

function environment() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const env: RecoveryEnvironment = {
    window, document, now: Date.now,
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (timer) => clearInterval(timer as ReturnType<typeof setInterval>),
  };
  return { window, document, env };
}

describe('connection recovery signals', () => {
  it('retries on network restoration and when the app becomes active', () => {
    vi.useFakeTimers();
    const { window, document, env } = environment();
    const recover = vi.fn();
    const stop = installConnectionRecovery(recover, env);
    document.visibilityState = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(recover).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('online'));
    expect(recover).toHaveBeenCalledTimes(1);
    document.visibilityState = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(recover).toHaveBeenCalledTimes(3);
    stop();
  });

  it('notices a resumed timer after sleep without regularly polling the server', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { env } = environment();
    const recover = vi.fn();
    const stop = installConnectionRecovery(recover, env);
    vi.advanceTimersByTime(60_000);
    expect(recover).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + RESUME_GAP_MS + 1);
    vi.advanceTimersByTime(10_000);
    expect(recover).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20_000);
    expect(recover).toHaveBeenCalledTimes(1);
    stop();
  });

  it('removes listeners and the timer when disposed', () => {
    vi.useFakeTimers();
    const { window, document, env } = environment();
    const recover = vi.fn();
    const stop = installConnectionRecovery(recover, env);
    stop();
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    vi.setSystemTime(Date.now() + 60_000);
    vi.advanceTimersByTime(20_000);
    expect(recover).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
