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
    if (!args[0]?.startsWith('/auth/') && !config.offlineQueueSession && !config.sessionSnapshot) {
      try { args[index] = { ...config, ...getSessionRequestConfig() }; }
      catch (error) { return Promise.reject(error); }
    }
    return original(...args);
  };
}

// Add a request interceptor for attaching the JWT token
apiClient.interceptors.request.use(
  (config) => {
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
      return config;
    }
    const session = (config as InternalAxiosRequestConfig & {
      sessionSnapshot?: QueueSession;
    }).sessionSnapshot;
    if (session) {
      if (!isSessionCurrent(session) || (session.pendingVerification && config.url !== '/users/me')) throw new Error('Session changed or needs verification before dispatch');
      if (session.token) config.headers.Authorization = `Bearer ${session.token}`;
      else { config.headers.delete?.('Authorization'); delete config.headers.Authorization; delete config.headers.authorization; }
      return config;
    }
    if (!config.url?.startsWith('/auth/')) throw new Error('Protected request needs a captured session');
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add a response interceptor for logging errors
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    // Queue failures persist their authentication retry state before invalidation.
    const config = error.config;
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
