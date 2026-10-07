import axios from 'axios';
import type { InternalAxiosRequestConfig } from 'axios';
import { isOfflineQueueSessionActive, isSessionCurrent, getOfflineQueueSession, invalidateCurrentSession } from '../utils/queueSession';
import type { QueueSession } from '../utils/queueSession';

const apiClient = axios.create({
  timeout: 45_000,
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  headers: {
    'Content-Type': 'application/json',
  },
});

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
      if (!isSessionCurrent(session)) throw new Error('Session changed before dispatch');
      if (session.token) config.headers.Authorization = `Bearer ${session.token}`;
      return config;
    }
    const snapshot = getOfflineQueueSession();
    (config as InternalAxiosRequestConfig & { sessionSnapshot?: QueueSession }).sessionSnapshot = snapshot;
    const token = snapshot.token;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add a response interceptor for logging errors
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Queue failures persist their authentication retry state before invalidation.
    const config = error.config;
    if (error.response?.status === 401 && !config?.url?.startsWith('/auth/')
      && !config?.offlineQueueSession && config?.sessionSnapshot) {
      invalidateCurrentSession(config.sessionSnapshot);
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
