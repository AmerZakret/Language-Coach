export const CLIENT_PROTOCOL_REVISION = 2;
export const CLIENT_PROTOCOL_HEADER = 'X-Client-Protocol';
declare const __WEB_BUILD_ID__: string | undefined;
export const WEB_BUILD_ID = typeof __WEB_BUILD_ID__ === 'string' ? __WEB_BUILD_ID__ : 'development';
export function isProtocolMutation(method = 'get', url = ''): boolean {
  const path = url.split('?')[0].replace(/\/+$/, '');
  if (/^\/progress\/[^/]+\/reset-receipts\//.test(path)) return true;
  if (/^\/auth\/(register|guest)$/.test(path) || path === '/users/profile') return true;
  return !['get', 'head', 'options'].includes(method.toLowerCase()) &&
    !['/auth/login', '/ai-coach/writing-check', '/pronunciation/assess'].includes(path);
}
