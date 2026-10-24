export const CLIENT_PROTOCOL_REVISION = 1;
export const CLIENT_PROTOCOL_HEADER = 'X-Client-Protocol';
declare const __WEB_BUILD_ID__: string | undefined;
export const WEB_BUILD_ID = typeof __WEB_BUILD_ID__ === 'string' ? __WEB_BUILD_ID__ : 'development';
export function isProtocolMutation(method = 'get', url = ''): boolean {
  const path = url.split('?')[0].replace(/\/+$/, '');
  return !['get', 'head', 'options'].includes(method.toLowerCase()) &&
    (/^\/(progress|flashcards|community\/posts)(\/|$)/.test(path) || /^\/ai-coach\/(chat|clear)$/.test(path));
}
