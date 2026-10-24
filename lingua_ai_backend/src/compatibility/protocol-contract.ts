export const CURRENT_CLIENT_PROTOCOL = 1;
export const MINIMUM_MUTATION_PROTOCOL = CURRENT_CLIENT_PROTOCOL;
export const CLIENT_PROTOCOL_HEADER = 'X-Client-Protocol';
export type ProtocolPolicy = 'ALLOW_LEGACY' | 'ENFORCE_MUTATIONS';
export type RouteClassification =
  | 'PROTOCOL_REQUIRED_WHEN_ENFORCED'
  | 'PROTOCOL_OPTIONAL'
  | 'NOT_APPLICABLE';
const required = 'PROTOCOL_REQUIRED_WHEN_ENFORCED';
const optional = 'PROTOCOL_OPTIONAL';
const none = 'NOT_APPLICABLE';
export const PROTOCOL_ROUTES = [
  ['GET', '/', none],
  ['GET', '/health', none],
  ['GET', '/health/live', none],
  ['GET', '/health/ready', none],
  ['GET', '/compatibility', none],
  ['POST', '/auth/login', none],
  ['POST', '/auth/register', none],
  ['POST', '/auth/guest', none],
  ['GET', '/users/me', optional],
  ['PATCH', '/users/profile', optional],
  ['GET', '/lessons', optional],
  ['GET', '/lessons/:id', optional],
  ['GET', '/progress/:userId', optional],
  ['GET', '/progress/:userId/reset-receipts/:operationId', optional],
  ['POST', '/progress/:userId/complete-lesson', required],
  ['DELETE', '/progress/:userId', required],
  ['GET', '/flashcards/all', optional],
  ['GET', '/flashcards/due', optional],
  ['POST', '/flashcards', required],
  ['PUT', '/flashcards/:id', required],
  ['DELETE', '/flashcards/:id', required],
  ['PUT', '/flashcards/:id/review', required],
  ['GET', '/community/posts', optional],
  ['POST', '/community/posts', required],
  ['PUT', '/community/posts/:id', required],
  ['DELETE', '/community/posts/:id', required],
  ['POST', '/community/posts/:id/like', required],
  ['GET', '/ai-coach/history', optional],
  ['POST', '/ai-coach/chat', required],
  ['DELETE', '/ai-coach/clear', required],
  ['POST', '/ai-coach/writing-check', optional],
  ['POST', '/pronunciation/assess', optional],
] as const;
export function protocolRoute(
  method: string,
  path: string,
): RouteClassification {
  return (
    PROTOCOL_ROUTES.find((row) => row[0] === method && row[1] === path)?.[2] ??
    (['GET', 'HEAD', 'OPTIONS'].includes(method) ? optional : required)
  );
}
export function protocolMetadata(
  policy: ProtocolPolicy,
  buildId = 'development',
) {
  return {
    currentProtocolRevision: CURRENT_CLIENT_PROTOCOL,
    minimumMutationRevision: MINIMUM_MUTATION_PROTOCOL,
    policy,
    buildId,
  };
}
