import { dataTimeline } from '../utils/dataTimeline';
import type { OperationTimeline } from '../utils/dataTimeline';
import { getSessionRequestConfig, isSessionCurrent } from '../utils/queueSession';
import type { AxiosRequestConfig } from 'axios';
export const newMutationId = (): string => crypto.randomUUID();
const operationContexts = new Map<string, OperationTimeline>();
const mutationTails = new Map<string, Promise<void>>();
export async function mutationRequest<T>(operationId: string, send: (config: AxiosRequestConfig) => Promise<T>, serialResource?: string, stored?: OperationTimeline): Promise<T> {
  const session = getSessionRequestConfig();
  const key = `${session.sessionSnapshot.ownerNamespace}:${operationId}`;
  const operation = operationContexts.get(key) ?? Object.freeze({ ...(stored ?? dataTimeline.capture()) });
  operationContexts.set(key, operation);
  const config = { ...session, ...operation, headers: { 'X-Idempotency-Key': operationId } };
  const attempt = async () => {
    dataTimeline.assertDispatch(operation);
    if (!isSessionCurrent(session.sessionSnapshot)) throw new Error('Mutation session changed');
    try { return await send(config); }
    catch (error: any) {
      if (!isSessionCurrent(session.sessionSnapshot) || Number(error.response?.headers?.['retry-after']) > 0 || (error.response && error.response.status < 500)) throw error;
      dataTimeline.assertDispatch(operation);
      return send(config);
    }
  };
  if (!serialResource) return attempt();
  const resourceKey = `${session.sessionSnapshot.ownerNamespace}:${serialResource}`;
  const previous = mutationTails.get(resourceKey) || Promise.resolve();
  const result = previous.then(attempt);
  const released = result.then(() => {}, () => {});
  mutationTails.set(resourceKey, released);
  try { return await result; }
  finally { if (mutationTails.get(resourceKey) === released) mutationTails.delete(resourceKey); }
}
