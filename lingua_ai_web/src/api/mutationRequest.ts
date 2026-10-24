import { getSessionRequestConfig, isSessionCurrent } from '../utils/queueSession';
import type { AxiosRequestConfig } from 'axios';
export const newMutationId = (): string => crypto.randomUUID();
const mutationTails = new Map<string, Promise<void>>();
export async function mutationRequest<T>(operationId: string, send: (config: AxiosRequestConfig) => Promise<T>, serialResource?: string): Promise<T> {
  const session = getSessionRequestConfig();
  const config = { ...session, headers: { 'X-Idempotency-Key': operationId } };
  const attempt = async () => {
    if (!isSessionCurrent(session.sessionSnapshot)) throw new Error('Mutation session changed');
    try { return await send(config); }
    catch (error: any) {
      if (!isSessionCurrent(session.sessionSnapshot) || Number(error.response?.headers?.['retry-after']) > 0 || (error.response && error.response.status < 500)) throw error;
      return send(config);
    }
  };
  if (!serialResource) return attempt();
  const key = `${session.sessionSnapshot.ownerNamespace}:${serialResource}`;
  const previous = mutationTails.get(key) || Promise.resolve();
  const result = previous.then(attempt);
  const released = result.then(() => {}, () => {});
  mutationTails.set(key, released);
  try { return await result; }
  finally { if (mutationTails.get(key) === released) mutationTails.delete(key); }
}
