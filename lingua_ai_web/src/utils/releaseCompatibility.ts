import { dataTimeline } from './dataTimeline';
import { CLIENT_PROTOCOL_REVISION, WEB_BUILD_ID } from './clientProtocol';
interface CompatibilityMetadata {
  currentProtocolRevision: number;
  minimumMutationRevision: number;
  policy: 'ALLOW_LEGACY' | 'ENFORCE_MUTATIONS';
  buildId: string;
}
interface ReleaseManifest { protocolRevision: number; buildId: string }
interface CompatibilityState { updateRequired: boolean; newBuildAvailable: boolean }
const revision = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999999;
const build = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._-]{1,96}$/.test(value);
export const compatibilityCode = (value: unknown): boolean => value === 'CLIENT_PROTOCOL_REQUIRED' || value === 'CLIENT_PROTOCOL_UNSUPPORTED';
export class ClientUpdateRequired extends Error {
  readonly code = 'CLIENT_PROTOCOL_UNSUPPORTED';
  constructor() { super('Update or reconcile this client before submitting pending work. Saved work is preserved.'); }
}
export class ReleaseCompatibility {
  private state: CompatibilityState = { updateRequired: false, newBuildAvailable: false };
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setInterval>;
  private checking?: Promise<void>;
  private started = false;
  private readonly base = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/$/, '');
  readonly storageKey = `linguaai_compatibility_${encodeURIComponent(this.base)}`;
  snapshot = (): CompatibilityState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(updateRequired: boolean, newBuildAvailable: boolean) {
    if (this.state.updateRequired === updateRequired && this.state.newBuildAvailable === newBuildAvailable) return;
    this.state = { updateRequired, newBuildAvailable };
    for (const listener of this.listeners) listener();
  }
  private advertise(value: object) {
    try { localStorage.setItem(this.storageKey, JSON.stringify(value)); } catch { /* Memory enforcement remains active. */ }
  }
  observeMetadata(value: unknown, broadcast = true): void {
    if (!value || typeof value !== 'object') return;
    const data = value as Partial<CompatibilityMetadata>;
    if (!revision(data.currentProtocolRevision) || !revision(data.minimumMutationRevision) ||
      data.minimumMutationRevision > data.currentProtocolRevision || !['ALLOW_LEGACY', 'ENFORCE_MUTATIONS'].includes(data.policy || '') || !build(data.buildId)) return;
    const incompatible = CLIENT_PROTOCOL_REVISION < data.minimumMutationRevision || CLIENT_PROTOCOL_REVISION > data.currentProtocolRevision;
    this.publish(this.state.updateRequired || incompatible, this.state.newBuildAvailable);
    if (broadcast) this.advertise({ type: 'metadata', data: { currentProtocolRevision: data.currentProtocolRevision, minimumMutationRevision: data.minimumMutationRevision, policy: data.policy, buildId: data.buildId } });
  }
  observeRelease(value: unknown, broadcast = true): void {
    if (!value || typeof value !== 'object') return;
    const data = value as Partial<ReleaseManifest>;
    if (!revision(data.protocolRevision) || !build(data.buildId)) return;
    this.publish(this.state.updateRequired || data.protocolRevision !== CLIENT_PROTOCOL_REVISION,
      this.state.newBuildAvailable || data.buildId !== WEB_BUILD_ID);
    if (broadcast) this.advertise({ type: 'release', data: { protocolRevision: data.protocolRevision, buildId: data.buildId } });
  }
  reject(): void {
    this.publish(true, this.state.newBuildAvailable);
    this.advertise({ type: 'rejected', protocolRevision: CLIENT_PROTOCOL_REVISION, buildId: WEB_BUILD_ID });
  }
  private readAdvertisement() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw || raw.length > 2048) return;
      const value = JSON.parse(raw) as { type?: string; data?: unknown; protocolRevision?: unknown; buildId?: unknown };
      if (value.type === 'metadata') this.observeMetadata(value.data, false);
      if (value.type === 'release') this.observeRelease(value.data, false);
      if (value.type === 'rejected' && value.protocolRevision === CLIENT_PROTOCOL_REVISION && value.buildId === WEB_BUILD_ID)
        this.publish(true, this.state.newBuildAvailable);
    } catch { /* Compatibility storage never repairs or reads owner queues/auth. */ }
  }
  assertMutationAllowed(): void {
    this.readAdvertisement();
    if (this.state.updateRequired) throw new ClientUpdateRequired();
  }
  private storage = (event: StorageEvent) => { if (event.key === this.storageKey) this.readAdvertisement(); };
  refresh = (): Promise<void> => {
    if (this.checking) return this.checking;
    this.checking = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        await Promise.allSettled([
          dataTimeline.refresh().then(metadata => this.observeMetadata(metadata)),
          fetch('/release.json', { cache: 'no-store', credentials: 'omit', signal: controller.signal })
            .then(async response => { if (response.ok) this.observeRelease(await response.json()); }),
        ]);
      } finally { clearTimeout(timeout); }
    })().finally(() => { this.checking = undefined; });
    return this.checking;
  };
  start() {
    if (this.started) return;
    this.started = true; this.readAdvertisement();
    window.addEventListener('storage', this.storage); window.addEventListener('focus', this.refresh);
    void this.refresh(); this.timer = setInterval(() => { void this.refresh(); }, 300000);
  }
  stop() {
    if (!this.started) return;
    this.started = false; clearInterval(this.timer);
    window.removeEventListener('storage', this.storage); window.removeEventListener('focus', this.refresh);
  }
}
export const releaseCompatibility = new ReleaseCompatibility();
