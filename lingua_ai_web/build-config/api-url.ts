function localHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')
    || h === 'host.docker.internal' || h === '::' || h === '::1' || h.startsWith('::ffff:')
    || /^(?:127|0|10)\./.test(h) || /^192\.168\./.test(h)
    || /^172\.(?:1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h)
    || /^f[cd][\da-f]{2}:/.test(h) || /^fe[89ab][\da-f]:/.test(h);
}

/** Used by Vite before generating any production bundle; no network access. */
export function validateApiUrl(value: string | undefined, production: boolean, selfHosted = false): string {
  const raw = value?.trim() || (production ? '' : 'http://localhost:3000');
  const fail = (): never => { throw new Error('VITE_API_URL must be an explicit HTTPS API URL; local HTTP endpoints require VITE_ALLOW_LOCAL_API=true for self-hosted deployments.'); };
  let url: URL;
  try { url = new URL(raw); } catch { return fail(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return fail();
  const local = localHost(url.hostname);
  if (production && ((local && !selfHosted) || (url.protocol !== 'https:' && !(local && selfHosted)))) return fail();
  return raw.replace(/\/+$/, '');
}
