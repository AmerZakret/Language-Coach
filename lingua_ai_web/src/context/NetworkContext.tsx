import React, { createContext, useContext, useState, useEffect } from 'react';
import { backendReachability } from '../utils/backendReachability';
import type { ReachabilityState } from '../utils/backendReachability';

interface NetworkContextType extends ReachabilityState { isOffline: boolean }
const NetworkContext = createContext<NetworkContextType>({
  isOffline: true, networkAvailable: true, backendReachable: false, backendState: 'unknown',
});
export const NetworkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState(backendReachability.snapshot);
  useEffect(() => {
    const unsubscribe = backendReachability.subscribe(() => setState(backendReachability.snapshot()));
    backendReachability.start();
    return () => { unsubscribe(); backendReachability.stop(); };
  }, []);
  return (
    <NetworkContext.Provider value={{ ...state, isOffline: !state.networkAvailable || !state.backendReachable }}>
      {children}
    </NetworkContext.Provider>
  );
};
export const useNetwork = () => useContext(NetworkContext);
