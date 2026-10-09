import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { SyncCoordinator } from '../utils/syncCoordinator';
import { subscribeOfflineQueue } from '../utils/offlineQueue';
const SyncContext = createContext({ syncRevision: 0, lastDrainSucceeded: false });
export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuth();
  const [state, setState] = useState({ syncRevision: 0, lastDrainSucceeded: false });
  const coordinator = useRef<SyncCoordinator | null>(null);
  useEffect(() => {
    let active = true;
    const service = new SyncCoordinator(undefined, success => {
      if (active) setState(previous => ({ syncRevision: previous.syncRevision + 1, lastDrainSucceeded: success }));
    });
    coordinator.current = service; service.start();
    const unsubscribe = subscribeOfflineQueue(external => {
      if (active && external) setState(previous => ({ syncRevision: previous.syncRevision + 1, lastDrainSucceeded: false }));
    });
    return () => { active = false; unsubscribe(); service.stop(); coordinator.current = null; };
  }, []);
  useEffect(() => { coordinator.current?.wake(); }, [user, token]);
  return <SyncContext.Provider value={state}>{children}</SyncContext.Provider>;
};
export const useSync = () => useContext(SyncContext);
