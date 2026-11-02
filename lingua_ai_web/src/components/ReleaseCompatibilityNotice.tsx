import { useEffect, useSyncExternalStore } from 'react';
import { releaseCompatibility } from '../utils/releaseCompatibility';
import { WEB_BUILD_ID } from '../utils/clientProtocol';
export function ReleaseCompatibilityNotice() {
  const state = useSyncExternalStore(releaseCompatibility.subscribe, releaseCompatibility.snapshot);
  useEffect(() => { releaseCompatibility.start(); return () => releaseCompatibility.stop(); }, []);
  if (!state.updateRequired && !state.newBuildAvailable) return null;
  return <aside role="alert" style={{ padding: 16, background: '#FEF3C7', color: '#78350F' }}>
    {state.updateRequired ? 'Client update or pending-work reconciliation is required. Mutations are paused.' : 'A different deployed build is available.'}
    {' Saved work and account data are preserved. '}
    <button onClick={() => window.location.reload()}>Reload application</button>
    <small> Current build: {WEB_BUILD_ID}</small>
  </aside>;
}
