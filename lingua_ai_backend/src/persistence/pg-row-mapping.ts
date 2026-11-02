import { ApplicationPgError } from './pg-errors';

export const PAYLOAD_ENCODING = 'LC-PG-TEXT-1';
export function encodePayloadText(value: string): string {
  if (Buffer.from(value, 'utf8').toString('utf8') !== value)
    throw new ApplicationPgError('CHECK');
  return value.replaceAll('\\', '\\\\').replaceAll('\0', '\\0');
}
export function decodePayloadText(value: string): string {
  let result = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c !== '\\') {
      result += c;
      continue;
    }
    const escaped = value[++i];
    if (escaped === '\\') result += '\\';
    else if (escaped === '0') result += '\0';
    else throw new ApplicationPgError('CHECK');
  }
  return result;
}
// JSON-only boundary: Dates/ObjectIds must first receive field-aware mapping.
// Own data properties only; never invoke a getter or assign __proto__.
export function mapPayloadJson(value: unknown, decode = false): unknown {
  let nodes = 0;
  let bytes = 0;
  const ancestors = new Set<object>();
  const text = (input: string) => {
    const result = decode ? decodePayloadText(input) : encodePayloadText(input);
    bytes += Buffer.byteLength(input) + Buffer.byteLength(result);
    if (bytes > 8 * 1024 * 1024) throw new ApplicationPgError('CHECK');
    return result;
  };
  const visit = (input: unknown, depth: number): unknown => {
    if (++nodes > 100000 || depth > 64) throw new ApplicationPgError('CHECK');
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input === 'string') return text(input);
    if (typeof input !== 'object' || input === null || ancestors.has(input))
      throw new ApplicationPgError('CHECK');
    const prototype: unknown = Object.getPrototypeOf(input);
    if (
      !Array.isArray(input) &&
      prototype !== Object.prototype &&
      prototype !== null
    )
      throw new ApplicationPgError('CHECK');
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        if (input.length > 100000) throw new ApplicationPgError('CHECK');
        return Array.from({ length: input.length }, (_, i) => {
          const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
          if (!descriptor || !('value' in descriptor))
            throw new ApplicationPgError('CHECK');
          return visit(descriptor.value, depth + 1);
        });
      }
      const output: Record<string, unknown> = Object.create(null) as Record<
        string,
        unknown
      >;
      for (const key of Object.keys(input)) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
        if (!('value' in descriptor)) throw new ApplicationPgError('CHECK');
        output[text(key)] = visit(descriptor.value, depth + 1);
      }
      return output;
    } finally {
      ancestors.delete(input);
    }
  };
  return visit(value, 0);
}
export function safeCounter(value: string | number): number {
  if (typeof value === 'string' && !/^[0-9]+$/.test(value))
    throw new ApplicationPgError('CHECK');
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new ApplicationPgError('CHECK');
  return result;
}
