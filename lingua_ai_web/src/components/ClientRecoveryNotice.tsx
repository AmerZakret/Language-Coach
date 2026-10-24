import { useEffect, useState } from 'react';
import { useNetwork } from '../context/NetworkContext';
import { useAuth } from '../context/AuthContext';
import { listOnlineIntents, subscribeOnlineIntents } from '../utils/onlineIntents';
import { recoverOnlineIntents } from '../api/intentRecovery';

export function ClientRecoveryNotice() {
  const { isOffline } = useNetwork();
  const { token, user } = useAuth();
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (!token) { if (active) setMessage(''); return; }
      try {
        const items = await listOnlineIntents();
        if (active) setMessage(items.length ? items.some(item => item.state === 'failed')
          ? 'A saved action was rejected or conflicted. Check authoritative history/feed before replacing it; recovery evidence is preserved.'
          : 'A previous action is awaiting confirmation. Recovery uses the original saved operation; pending work is preserved.' : '');
      } catch { if (active) setMessage('Pending action storage needs recovery. Existing evidence is preserved.'); }
    };
    void refresh();
    const unsubscribe = subscribeOnlineIntents(() => { void refresh(); });
    return () => { active = false; unsubscribe(); };
  }, [token, user?.id]);
  if (!message) return null;
  return <aside role="status" className="p-4 bg-amber-50 text-amber-900">{message}
    <button disabled={isOffline} className="ml-3 underline" onClick={async () => {
      try { await recoverOnlineIntents('community'); await recoverOnlineIntents('ai'); }
      catch { /* The journal and its explicit recovery state remain visible. */ }
    }}>Recover saved actions</button>
  </aside>;
}
