export interface ReachabilityState {
  networkAvailable: boolean;
  backendReachable: boolean;
  backendState: 'unknown' | 'reachable' | 'unreachable';
}
export class BackendReachability {
  private state: ReachabilityState = { networkAvailable: true, backendReachable: false, backendState: 'unknown' };
  private listeners = new Set<() => void>();
  private checking?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private generation = 0;
  private started = false;
  private readonly probe: () => Promise<boolean>;
  constructor(probe: () => Promise<boolean> = probeBackendHealth) { this.probe = probe; }
  snapshot = (): ReachabilityState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };
  private publish(backendReachable: boolean, backendState: ReachabilityState['backendState']) {
    if (this.state.backendReachable === backendReachable && this.state.backendState === backendState) return;
    this.state = { ...this.state, backendReachable, backendState };
    for (const listener of this.listeners) listener();
  }
  setNetworkAvailable = (available: boolean) => {
    if (this.state.networkAvailable !== available) {
      ++this.generation;
      this.state = { networkAvailable: available, backendReachable: false, backendState: available ? 'unknown' : 'unreachable' };
      for (const listener of this.listeners) listener();
    }
    if (available) void this.refresh();
  };
  refresh = (): Promise<void> => {
    if (!this.state.networkAvailable) return Promise.resolve();
    if (this.checking) return this.checking;
    const generation = this.generation;
    this.checking = (async () => {
      let reachable = false;
      try { reachable = await this.probe(); } catch { /* Network errors mean unavailable. */ }
      if (generation === this.generation && this.state.networkAvailable) {
        this.publish(reachable, reachable ? 'reachable' : 'unreachable');
      }
    })().finally(() => {
      this.checking = undefined;
      // A network transition during a probe invalidates its response.
      if (this.started && generation !== this.generation && this.state.networkAvailable) void this.refresh();
    });
    return this.checking;
  };
  private online = () => this.setNetworkAvailable(true);
  private offline = () => this.setNetworkAvailable(false);
  start() {
    if (this.started) return;
    this.started = true;
    window.addEventListener('online', this.online); window.addEventListener('offline', this.offline);
    this.setNetworkAvailable(navigator.onLine);
    this.timer = setInterval(() => { void this.refresh(); }, 30_000);
  }
  stop() {
    if (!this.started) return;
    this.started = false; ++this.generation;
    clearInterval(this.timer);
    window.removeEventListener('online', this.online); window.removeEventListener('offline', this.offline);
  }
}

async function probeBackendHealth(): Promise<boolean> {
  const base = import.meta.env.VITE_API_URL || 'http://localhost:3000';
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<false>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(false); }, 5_000);
  });
  try {
    return await Promise.race([fetch(`${base.replace(/\/$/, '')}/health`, {
      signal: controller.signal, cache: 'no-store', credentials: 'omit',
    }).then(async response => response.ok && (await response.json()).status === 'ok'), deadline]);
  } catch { return false; }
  finally { clearTimeout(timer!); }
}
export const backendReachability = new BackendReachability();
