import { useEffect, useState } from 'react';
import { useNetwork } from '../context/NetworkContext';
import { useAuth } from '../context/AuthContext';
import { listOnlineIntents, subscribeOnlineIntents } from '../utils/onlineIntents';
import { recoverOnlineIntents } from '../api/intentRecovery';
import { discardOnlineIntent } from '../utils/onlineIntents';
import { dataTimeline } from '../utils/dataTimeline';
import { discardOfflineAction, getOfflineQueue, getFailedOfflineActions, subscribeOfflineQueue } from '../utils/offlineQueue';

export function ClientRecoveryNotice() {
  const { isOffline } = useNetwork();
  const { token, user } = useAuth();
  const [message, setMessage] = useState('');
  const [review, setReview] = useState<{ id: string; kind: string; payload: unknown; journal: boolean }[]>([]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!token) { if (active) setMessage(''); return; }
      try {
        const items = await listOnlineIntents();
        const oldIntents = items.filter(item => dataTimeline.provenance(item) !== 'CURRENT' || ['timeline', 'provenance'].includes(item.category || ''))
          .map(item => ({ id: item.id, kind: item.kind, payload: item.payload, journal: true }));
        const oldActions = [...getOfflineQueue(), ...getFailedOfflineActions()].filter(item => dataTimeline.provenance(item) !== 'CURRENT' || ['timeline', 'provenance'].includes(item.lastErrorCategory || ''))
          .map(item => ({ id: item.id, kind: item.type, payload: item.payload, journal: false }));
        if (active) setReview([...oldIntents, ...oldActions]);
        if (active) setMessage(items.length ? items.some(item => item.state === 'failed')
          ? 'A saved action was rejected or conflicted. Check authoritative history/feed before replacing it; recovery evidence is preserved.'
          : 'A previous action is awaiting confirmation. Recovery uses the original saved operation; pending work is preserved.' : '');
      } catch { if (active) setMessage('Pending action storage needs recovery. Existing evidence is preserved.'); }
    };
    void refresh();
    const unsubscribe = subscribeOnlineIntents(() => { void refresh(); });
    const unsubscribeQueue = subscribeOfflineQueue(() => { void refresh(); });
    const unsubscribeTimeline = dataTimeline.subscribe(() => { void refresh(); });
    return () => { active = false; unsubscribe(); unsubscribeQueue(); unsubscribeTimeline(); };
  }, [token, user?.id]);
  if (!message && !review.length) return null;
  return <aside role="status" className="p-4 bg-amber-50 text-amber-900">{message}
    {!!review.length && <p>Some saved actions were created before server data was restored, or their origin cannot be verified. Review current data, then re-enter any desired action as a new action.</p>}
    {review.map(item => <details key={item.id}>
      <summary>Review saved {item.kind.replaceAll('-', ' ')} action</summary>
      <pre className="whitespace-pre-wrap">{JSON.stringify(item.payload, (key, value) => key === 'base64' ? '[saved image]' : value, 2)}</pre>
      <button className="underline" onClick={async () => {
        if (!window.confirm('Discard this selected local action and its saved evidence?')) return;
        if (item.journal) await discardOnlineIntent(item.id);
        else await discardOfflineAction(item.id);
      }}>Discard selected local action</button>
    </details>)}
    <button disabled={isOffline} className="ml-3 underline" onClick={async () => {
      try { await recoverOnlineIntents('community'); await recoverOnlineIntents('ai'); }
      catch { /* The journal and its explicit recovery state remain visible. */ }
    }}>Recover saved actions</button>
  </aside>;
}
