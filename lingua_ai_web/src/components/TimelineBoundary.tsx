import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { dataTimeline } from '../utils/dataTimeline';
import { useAuth } from '../context/AuthContext';
import { fetchMe } from '../api/authApi';
import { readStoredSession } from '../utils/authSessionStorage';

export function TimelineBoundary({ children }: { children: React.ReactNode }) {
  const state = useSyncExternalStore(dataTimeline.subscribe, dataTimeline.snapshot);
  const { token, updateUser } = useAuth();
  const profileCurrent = !token || (state.lastConfirmed !== undefined && readStoredSession().profileDataTimelineId === state.lastConfirmed);
  const updateUserRef = useRef(updateUser);
  useEffect(() => { updateUserRef.current = updateUser; }, [updateUser]);
  const [refreshed, setRefreshed] = useState<string>();
  useEffect(() => { dataTimeline.start(); return () => dataTimeline.stop(); }, []);
  useEffect(() => {
    if ((state.status !== 'CHANGED' && profileCurrent) || state.writeState === 'UNAVAILABLE') return;
    let active = true;
    const context = dataTimeline.context();
    void (async () => {
      try {
        if (token && !profileCurrent) {
          const user = await fetchMe();
          if (!active || !dataTimeline.isContext(context)) return;
          await updateUserRef.current(user);
        }
        if (active && dataTimeline.isContext(context)) setRefreshed(state.lastConfirmed);
      } catch { /* Keep stale profile and all dependent mutation surfaces hidden. */ }
    })();
    return () => { active = false; };
  }, [state.status, state.lastConfirmed, state.writeState, token, profileCurrent]);
  if (state.status === 'CHANGED') return <aside role="alert" className="p-4 bg-amber-50 text-amber-900">
    Server data was restored. Some pending actions were created before the restore and need review.
    <button className="ml-3 underline" onClick={() => {
      if (refreshed === state.lastConfirmed) dataTimeline.resumeAfterRefresh(state.lastConfirmed);
      else void dataTimeline.refresh();
    }}>Refresh current state</button>
    {refreshed !== state.lastConfirmed && <p>Confirming current account data. Pending actions remain saved.</p>}
  </aside>;
  if (state.status === 'UNKNOWN' && navigator.onLine !== false) return <p role="status">Confirming server data...</p>;
  if (!profileCurrent) return <aside role="status" className="p-4 bg-amber-50 text-amber-900">
    Connect to confirm current account data. Your session and pending actions remain saved.
    <button className="ml-3 underline" onClick={() => { void dataTimeline.refresh(); }}>Refresh current state</button>
  </aside>;
  return <Fragment key={state.revision}>
    {(state.writeState !== 'OPEN' || state.status === 'UNAVAILABLE') && <aside role="status" className="p-4 bg-amber-50 text-amber-900">
      Server recovery or maintenance is in progress. Pending actions are preserved.
      <button className="ml-3 underline" onClick={() => { void dataTimeline.refresh(); }}>Check again</button>
    </aside>}
    {children}
  </Fragment>;
}
