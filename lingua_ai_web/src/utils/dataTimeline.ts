import { coordinationAvailable, withBrowserLock } from './browserCoordination';

export const isDataTimelineId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
export type TimelineStatus = 'UNKNOWN' | 'CURRENT' | 'CHANGED' | 'UNAVAILABLE';
export interface TimelineSnapshot {
  readonly status: TimelineStatus;
  readonly lastConfirmed?: string;
  readonly revision: number;
  readonly writeState: 'OPEN' | 'CLOSED' | 'UNAVAILABLE';
}
export interface OperationTimeline { readonly dataTimelineId?: string }
export class TimelineRecoveryRequired extends Error {
  readonly code: string;
  constructor(code = 'TIMELINE_RECONCILIATION_REQUIRED') {
    super('Server data needs confirmation. Pending actions are preserved for review.');
    this.code = code;
  }
}

// Dataset metadata is global; no auth, owner identities or mutation payloads live here.
export class DataTimeline {
  private readonly base = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');
  readonly storageKey = `linguaai_data_timeline_${encodeURIComponent(this.base)}`;
  readonly advertisementKey = `${this.storageKey}_notice`;
  private state: TimelineSnapshot;
  private advertisement: string | null = null;
  private listeners = new Set<() => void>();
  private checking?: Promise<unknown>;
  private started = false;
  private restored = false;
  private reads = new Set<string>();
  constructor() {
    let lastConfirmed: string | undefined;
    try {
      const saved = JSON.parse(localStorage.getItem(this.storageKey) || 'null');
      if (saved?.schemaVersion === 1 && isDataTimelineId(saved.dataTimelineId)) lastConfirmed = saved.dataTimelineId;
      this.advertisement = localStorage.getItem(this.advertisementKey);
    } catch { /* Cached metadata never authorizes online dispatch. */ }
    this.state = { status: 'UNKNOWN', lastConfirmed, revision: 0, writeState: 'UNAVAILABLE' };
  }
  snapshot = (): TimelineSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(change: Partial<TimelineSnapshot>) {
    this.state = Object.freeze({ ...this.state, ...change });
    for (const listener of this.listeners) listener();
  }
  private invalidate(keepTimeline?: string, removeTimeline?: string) {
    this.reads.clear();
    // Only READ snapshots. Journals, queues, local guest work and auth survive.
    try {
      const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
      for (const key of keys) if (key && (
        /^progress_(?:epoch_)?(?:registered_|guest_)/.test(key) ||
        /^flashcards_(?:all|due)_[a-f\d]{24}_/i.test(key) ||
        key.startsWith('linguaai_community_feed_v2_') || key.startsWith('linguaai_lessons_')
      )) {
        let recorded: unknown;
        try { recorded = JSON.parse(localStorage.getItem(key) || 'null')?.dataTimelineId; } catch { /* Unknown read provenance. */ }
        if (isDataTimelineId(recorded) && (recorded === keepTimeline || (removeTimeline !== undefined && recorded !== removeTimeline))) continue;
        localStorage.removeItem(key);
      }
    } catch { /* Tag checks still reject old or unknown snapshots. */ }
  }
  private advertise(id?: string) {
    const value = JSON.stringify({ schemaVersion: 1, dataTimelineId: id, notice: crypto.randomUUID() });
    this.advertisement = value;
    try { localStorage.setItem(this.advertisementKey, value); } catch { /* Memory fence remains closed. */ }
  }
  reread = () => {
    try {
      const raw = localStorage.getItem(this.advertisementKey);
      if (raw === this.advertisement) return;
      this.advertisement = raw;
      const notice = JSON.parse(raw || 'null');
      if (!notice || notice.schemaVersion !== 1 || !isDataTimelineId(notice.dataTimelineId)
        || notice.dataTimelineId !== this.state.lastConfirmed) this.pause(false);
    } catch { this.pause(false); }
  };
  private pause(broadcast: boolean) {
    this.restored = true;
    this.invalidate(undefined, this.state.lastConfirmed);
    this.publish({ status: 'CHANGED', revision: this.state.revision + 1, writeState: 'UNAVAILABLE' });
    if (broadcast) this.advertise();
  }
  /** Called only with the body of a successful no-store compatibility response. */
  private confirm(value: unknown): void {
    const metadata = value as { dataTimelineId?: unknown; timelineWriteState?: unknown } | null;
    if (!isDataTimelineId(metadata?.dataTimelineId) || !['OPEN', 'CLOSED'].includes(String(metadata?.timelineWriteState))) {
      this.publish({ status: 'UNAVAILABLE', writeState: 'UNAVAILABLE' });
      return;
    }
    const id = metadata.dataTimelineId;
    const previous = this.state.lastConfirmed;
    const changed = previous !== undefined && previous !== id;
    if (changed || !previous) this.invalidate(id);
    this.restored ||= changed;
    this.publish({ lastConfirmed: id, status: changed || this.state.status === 'CHANGED' ? 'CHANGED' : 'CURRENT',
      writeState: metadata.timelineWriteState as 'OPEN' | 'CLOSED',
      revision: this.state.revision + (previous !== id ? 1 : 0) });
    try { localStorage.setItem(this.storageKey, JSON.stringify({ schemaVersion: 1, dataTimelineId: id })); } catch { /* No offline fallback if persistence fails. */ }
    if (previous !== id || this.advertisement === null) this.advertise(id);
  }
  refresh = (): Promise<unknown> => {
    if (this.checking) return this.checking;
    const discover = async () => {
      this.reread();
      const advertisement = this.advertisement;
      const revision = this.state.revision;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`${this.base}/compatibility`, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
        if (!response.ok) throw new TimelineRecoveryRequired();
        const metadata: unknown = await response.json();
        this.reread();
        // A later tab advertisement or timeline error defeats this response.
        if (advertisement !== this.advertisement || revision !== this.state.revision) return;
        this.confirm(metadata);
        return metadata;
      } catch {
        if (revision === this.state.revision) this.publish({ status: this.state.status === 'CHANGED' ? 'CHANGED' : 'UNAVAILABLE', writeState: 'UNAVAILABLE' });
      } finally { clearTimeout(timeout); }
    };
    this.checking = (coordinationAvailable() ? withBrowserLock(`linguaai:timeline:${this.base}`, discover) : discover())
      .catch(() => { this.publish({ status: this.state.status === 'CHANGED' ? 'CHANGED' : 'UNAVAILABLE', writeState: 'UNAVAILABLE' }); })
      .finally(() => { this.checking = undefined; });
    return this.checking;
  };
  async ensureDiscovered() {
    this.reread();
    if (this.state.status !== 'CURRENT') await this.refresh();
  }
  // Refreshing current views is explicit after a restore. No write evidence is changed.
  resumeAfterRefresh(expected = this.state.lastConfirmed) {
    this.reread();
    if (expected !== this.state.lastConfirmed || this.state.status !== 'CHANGED' || !isDataTimelineId(this.state.lastConfirmed) || this.state.writeState === 'UNAVAILABLE') throw new TimelineRecoveryRequired();
    this.publish({ status: 'CURRENT', revision: this.state.revision + 1 });
  }
  capture(): Readonly<{ dataTimelineId: string }> {
    this.reread();
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!isDataTimelineId(this.state.lastConfirmed) || this.state.status === 'CHANGED'
      || (!offline && (this.state.status !== 'CURRENT' || this.state.writeState !== 'OPEN'))) throw new TimelineRecoveryRequired();
    return Object.freeze({ dataTimelineId: this.state.lastConfirmed });
  }
  provenance(operation: OperationTimeline): 'CURRENT' | 'LEGACY_UNVERIFIED' | 'RESTORED' {
    this.reread();
    if (!isDataTimelineId(operation.dataTimelineId)) return 'LEGACY_UNVERIFIED';
    return operation.dataTimelineId === this.state.lastConfirmed ? 'CURRENT' : 'RESTORED';
  }
  assertDispatch(operation: OperationTimeline) {
    this.reread();
    if (!isDataTimelineId(operation.dataTimelineId)) throw new TimelineRecoveryRequired('SERVER_TIMELINE_REQUIRED');
    if (this.state.status !== 'CURRENT' || this.state.writeState !== 'OPEN' || operation.dataTimelineId !== this.state.lastConfirmed) throw new TimelineRecoveryRequired();
  }
  context = () => { this.reread(); return { revision: this.state.revision, dataTimelineId: this.state.lastConfirmed }; };
  isContext(context: ReturnType<DataTimeline['context']>): boolean {
    this.reread();
    return context.revision === this.state.revision && context.dataTimelineId === this.state.lastConfirmed;
  }
  confirmRead(owner: string, path: string) { this.reads.add(`${owner}:${this.domain(path)}`); }
  private domain(path: string) { return path.split('?')[0].split('/')[1]; }
  assertRead(owner: string, path: string) {
    if (this.restored && !this.reads.has(`${owner}:${this.domain(path)}`) && !path.startsWith('/auth/')) throw new TimelineRecoveryRequired();
  }
  handleFailure(status?: number, code?: string) {
    if (status === 409 && code === 'SERVER_TIMELINE_CHANGED') { this.pause(true); void this.refresh(); }
    if (status === 428 && code === 'SERVER_TIMELINE_REQUIRED') { this.pause(true); void this.refresh(); }
    if (status === 503 && code === 'BACKEND_NOT_READY') this.publish({ writeState: 'CLOSED' });
  }
  private storage = (event: StorageEvent) => { if (event.key === null || event.key === this.advertisementKey) { this.reread(); void this.refresh(); } };
  private foreground = () => { void this.refresh(); };
  start() {
    if (this.started) return;
    this.started = true;
    window.addEventListener('storage', this.storage);
    window.addEventListener('online', this.foreground);
    window.addEventListener('focus', this.foreground);
    void this.refresh();
  }
  stop() {
    this.started = false;
    window.removeEventListener('storage', this.storage);
    window.removeEventListener('online', this.foreground);
    window.removeEventListener('focus', this.foreground);
  }
}
export const dataTimeline = new DataTimeline();
