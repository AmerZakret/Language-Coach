import { coordinationAvailable } from './browserCoordination';
import { backendReachability } from './backendReachability';
import type { BackendReachability } from './backendReachability';
import { getOfflineQueue, getFailedOfflineActions, processOfflineQueue, subscribeOfflineQueue } from './offlineQueue';
import { getOfflineQueueSession, isOfflineQueueSessionActive } from './queueSession';

// One application subscription/timer. The queue's owner lock and captured
// session remain the final authority when a screen also requests a drain.
export class SyncCoordinator {
  private running = false;
  private started = false;
  private timer?: ReturnType<typeof setTimeout>;
  private unsubscribeQueue?: () => void;
  private unsubscribeHealth?: () => void;
  private readonly health: BackendReachability;
  private readonly onChanged: (success: boolean) => void;
  constructor(health: BackendReachability = backendReachability,
    onChanged: (success: boolean) => void = () => {}) { this.health = health; this.onChanged = onChanged; }
  start() {
    if (this.started) return;
    this.started = true;
    this.unsubscribeQueue = subscribeOfflineQueue(this.wake);
    this.unsubscribeHealth = this.health.subscribe(this.wake);
    this.wake();
  }
  stop() {
    this.started = false;
    clearTimeout(this.timer); this.unsubscribeQueue?.(); this.unsubscribeHealth?.();
  }
  wake = () => {
    if (!this.started || this.running) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.drain(); }, 0);
  };
  private schedule() {
    if (!coordinationAvailable() || !this.started || !this.health.snapshot().backendReachable) return;
    const session = getOfflineQueueSession();
    if (!isOfflineQueueSessionActive(session)) return;
    const first = getOfflineQueue()[0];
    if (!first) return;
    const delay = Math.max(1, first.nextAttemptAt ? Date.parse(first.nextAttemptAt) - Date.now() : 1);
    this.timer = setTimeout(() => { void this.drain(); }, delay);
  }
  private async drain() {
    if (!coordinationAvailable() || !this.started || this.running || !this.health.snapshot().backendReachable) return;
    const session = getOfflineQueueSession();
    if (!isOfflineQueueSessionActive(session)) return;
    this.running = true;
    let storageFailure = false;
    try {
      const actions = getOfflineQueue();
      if (!actions.length) return;
      if (actions[0].nextAttemptAt && Date.parse(actions[0].nextAttemptAt) > Date.now()) return;
      const beforeFailures = getFailedOfflineActions().length;
      const success = await processOfflineQueue(session.userId, true);
      if (!this.started || !isOfflineQueueSessionActive(session)) return;
      if (getOfflineQueue().length < actions.length || getFailedOfflineActions().length > beforeFailures) this.onChanged(success);
      if (!success) await this.health.refresh();
    } catch { /* Storage failure keeps the durable action; retry without spinning. */
      storageFailure = true;
    } finally {
      this.running = false;
      if (this.started) {
        if (storageFailure) this.timer = setTimeout(this.wake, 30_000);
        else {
          try { this.schedule(); }
          catch { this.timer = setTimeout(this.wake, 30_000); }
        }
      }
    }
  }
}
