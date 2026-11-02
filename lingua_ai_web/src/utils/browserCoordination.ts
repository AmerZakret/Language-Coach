// Web Locks are origin scoped and released by the browser on document teardown.
// No localStorage lease can safely replace this exclusion guarantee.
export class CoordinationUnavailable extends Error {
  constructor() { super('This browser needs Web Locks in a secure context to save or sync offline work. Existing work is preserved.'); }
}
export const coordinationAvailable = (): boolean => typeof navigator !== 'undefined' && !!navigator.locks?.request;
export const ownerLockName = (owner: string, kind: 'storage' | 'drain'): string =>
  `linguaai:queue:${kind}:${encodeURIComponent(owner)}`;
export function withBrowserLock<T>(name: string, work: () => T | Promise<T>): Promise<T> {
  if (!coordinationAvailable()) return Promise.reject(new CoordinationUnavailable());
  return navigator.locks.request(name, { mode: 'exclusive' }, work);
}
export const withOwnerStorage = <T,>(owner: string, work: () => T | Promise<T>): Promise<T> =>
  withBrowserLock(ownerLockName(owner, 'storage'), work);
