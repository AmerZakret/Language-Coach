import { useCallback, useEffect, useRef } from 'react';
import { getOfflineQueueSession, isSessionCurrent } from './queueSession';

// One session policy for queued dispatch and response handling. The component
// generation also invalidates work after language changes or unmount/remount.
export function useSessionGuard(owner: string, language?: string): () => () => boolean {
  const session = getOfflineQueueSession();
  const identity = JSON.stringify([owner, language, session.revision, session.token]);
  const lifecycle = useRef({ identity, generation: 0, mounted: true });
  if (lifecycle.current.identity !== identity) {
    lifecycle.current.identity = identity;
    lifecycle.current.generation++;
  }
  useEffect(() => {
    lifecycle.current.mounted = true;
    return () => {
      lifecycle.current.mounted = false;
      lifecycle.current.generation++;
    };
  }, []);
  return useCallback(() => {
    // Intent belongs to this render, including its token and generation.
    const captured = session;
    const generation = lifecycle.current.generation;
    const storedLanguage = localStorage.getItem('linguaai_target_language');
    return () => lifecycle.current.mounted
      && lifecycle.current.generation === generation
      && lifecycle.current.identity === identity
      && captured.ownerNamespace === owner && isSessionCurrent(captured)
      && (language === undefined || localStorage.getItem('linguaai_target_language') === storedLanguage);
  }, [identity, owner, language]);
}
