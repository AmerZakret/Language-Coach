import { dataTimeline, TimelineRecoveryRequired } from '../utils/dataTimeline';
import { CLIENT_PROTOCOL_REVISION, CLIENT_PROTOCOL_HEADER, isProtocolMutation } from '../utils/clientProtocol';
import { releaseCompatibility, compatibilityCode } from '../utils/releaseCompatibility';
import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { isOfflineQueueSessionActive, isSessionCurrent, getSessionRequestConfig, invalidateCurrentSession } from '../utils/queueSession';
import type { QueueSession } from '../utils/queueSession';

const apiClient = axios.create({
  timeout: 45_000,
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Capture intent synchronously at the API call, before Axios's asynchronous
// interceptor chain. In particular Community calls cannot adopt a new token.
for (const method of ['get', 'delete', 'head', 'options', 'post', 'put', 'patch'] as const) {
  if (!apiClient[method]) continue;
  const original = apiClient[method].bind(apiClient) as (...args: any[]) => any;
  (apiClient[method] as (...args: any[]) => any) = (...args: any[]) => {
    const index = ['post', 'put', 'patch'].includes(method) ? 2 : 1;
    const config = args[index] || {};
    if (!args[0]?.startsWith('/auth/') && args[0] !== '/compatibility' && !config.offlineQueueSession && !config.sessionSnapshot) {
      try { args[index] = { ...config, ...getSessionRequestConfig() }; }
      catch (error) { return Promise.reject(error); }
    }
    args[index] = { ...args[index], timelineContext: config.timelineContext ?? dataTimeline.context() };
    return original(...args);
  };
}

// Add a request interceptor for attaching the JWT token
apiClient.interceptors.request.use(
  async (config) => {
    if (isProtocolMutation(config.method, config.url)) releaseCompatibility.assertMutationAllowed();
    const enforceTimeline = () => {
    const timelineConfig = config as InternalAxiosRequestConfig & { dataTimelineId?: string; timelineContext?: ReturnType<typeof dataTimeline.context> };
    const mutation = isProtocolMutation(config.method, config.url);
    if (mutation) {
      dataTimeline.assertDispatch(timelineConfig);
      const owner = (config as InternalAxiosRequestConfig & { sessionSnapshot?: QueueSession; offlineQueueSession?: QueueSession }).sessionSnapshot?.ownerNamespace
        ?? (config as InternalAxiosRequestConfig & { offlineQueueSession?: QueueSession }).offlineQueueSession?.ownerNamespace;
      if (owner) dataTimeline.assertRead(owner, config.url || '');
      config.headers['X-Data-Timeline'] = timelineConfig.dataTimelineId;
    } else {
      config.headers.delete?.('X-Data-Timeline');
      delete config.headers['X-Data-Timeline']; delete config.headers['x-data-timeline'];
    }
    if (!dataTimeline.isContext(timelineConfig.timelineContext ?? dataTimeline.context())) throw new TimelineRecoveryRequired();
    };
    const protocol = (config as InternalAxiosRequestConfig & { clientProtocolRevision?: number | null }).clientProtocolRevision;
    if (protocol === null) {
      config.headers.delete?.(CLIENT_PROTOCOL_HEADER);
      delete config.headers[CLIENT_PROTOCOL_HEADER];
      delete config.headers['x-client-protocol'];
    } else config.headers[CLIENT_PROTOCOL_HEADER] = String(protocol ?? CLIENT_PROTOCOL_REVISION);
    const queueSession = (config as InternalAxiosRequestConfig & {
      offlineQueueSession?: QueueSession;
    }).offlineQueueSession;
    if (queueSession) {
      // Axios interceptors run asynchronously: verify again at dispatch rather
      // than replacing a queue request's credentials with the new user's token.
      if (!isOfflineQueueSessionActive(queueSession)) {
        throw new Error('Offline queue session changed before dispatch');
      }
      config.headers.Authorization = `Bearer ${queueSession.token}`;
      enforceTimeline();
      return config;
    }
    const session = (config as InternalAxiosRequestConfig & {
      sessionSnapshot?: QueueSession;
    }).sessionSnapshot;
    if (session) {
      if (!isSessionCurrent(session) || (session.pendingVerification && config.url !== '/users/me')) throw new Error('Session changed or needs verification before dispatch');
      if (session.token) config.headers.Authorization = `Bearer ${session.token}`;
      else { config.headers.delete?.('Authorization'); delete config.headers.Authorization; delete config.headers.authorization; }
      enforceTimeline();
      return config;
    }
    if (!config.url?.startsWith('/auth/') && config.url !== '/compatibility') throw new Error('Protected request needs a captured session');
    enforceTimeline();
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add a response interceptor for logging errors
apiClient.interceptors.response.use(
  (response) => {
    const config = response.config as (InternalAxiosRequestConfig & { timelineContext?: ReturnType<typeof dataTimeline.context>; sessionSnapshot?: QueueSession }) | undefined;
    if (config?.timelineContext && !dataTimeline.isContext(config.timelineContext)) throw new TimelineRecoveryRequired();
    if (config?.sessionSnapshot && config.method === 'get') dataTimeline.confirmRead(config.sessionSnapshot.ownerNamespace, config.url || '');
    return response;
  },
  async (error) => {
    const config = error.config;
    // Fence errors before they can pause a newer timeline, invalidate auth or
    // advertise a protocol failure from a discarded request context.
    if (config?.timelineContext && !dataTimeline.isContext(config.timelineContext)) return Promise.reject(new TimelineRecoveryRequired());
    // Queue failures persist their authentication retry state before invalidation.
    if (error.response?.status === 426 && compatibilityCode(error.response?.data?.code)) releaseCompatibility.reject();
    dataTimeline.handleFailure(error.response?.status, error.response?.data?.code);
    if (error.response?.status === 401 && !config?.url?.startsWith('/auth/')
      && !config?.offlineQueueSession && config?.sessionSnapshot) {
      await invalidateCurrentSession(config.sessionSnapshot).catch(() => {});
    }
    console.error('API Request Failed:', {
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      message: error.message,
    });
    return Promise.reject(error);
  }
);

export default apiClient;
