import { dataTimeline } from './dataTimeline';
import { useCallback, useEffect, useRef } from 'react';
import { getOfflineQueueSession, isSessionCurrent } from './queueSession';

// One session policy for queued dispatch and response handling. The component
// generation also invalidates work after language changes or unmount/remount.
export function useSessionGuard(owner: string, language?: string): () => () => boolean {
  const { ownerNamespace, userId, token, revision, pendingVerification } = getOfflineQueueSession();
  const renderedTimeline = dataTimeline.snapshot();
  const timelineRevision = renderedTimeline.revision;
  const timelineId = renderedTimeline.lastConfirmed;
  const identity = JSON.stringify([owner, language, revision, token, timelineRevision, timelineId]);
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
    const captured = { ownerNamespace, userId, token, revision, pendingVerification };
    const timeline = { revision: timelineRevision, dataTimelineId: timelineId };
    const generation = lifecycle.current.generation;
    const storedLanguage = localStorage.getItem('linguaai_target_language');
    return () => dataTimeline.isContext(timeline) && lifecycle.current.mounted
      && lifecycle.current.generation === generation
      && lifecycle.current.identity === identity
      && captured.ownerNamespace === owner && isSessionCurrent(captured)
      && (language === undefined || localStorage.getItem('linguaai_target_language') === storedLanguage);
  }, [identity, owner, language, ownerNamespace, userId, token, revision, pendingVerification, timelineRevision, timelineId]);
}
