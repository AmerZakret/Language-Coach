export type PgFailure =
  | 'DISABLED'
  | 'CONFIGURATION'
  | 'IDENTITY'
  | 'SCHEMA_MISMATCH'
  | 'UNIQUE'
  | 'FOREIGN_KEY'
  | 'CHECK'
  | 'PERMISSION'
  | 'SERIALIZATION'
  | 'DEADLOCK'
  | 'TIMEOUT'
  | 'CONNECTION'
  | 'ABORTED'
  | 'UNKNOWN_COMMIT'
  | 'TRANSACTION_USAGE'
  | 'SHUTDOWN'
  | 'DATABASE';

// No cause/detail/SQL/parameters/URI are retained on public errors.
export class ApplicationPgError extends Error {
  constructor(
    readonly category: PgFailure,
    readonly sqlState?: string,
  ) {
    super(`APPLICATION_PG_${category}`);
    this.name = 'ApplicationPgError';
  }
}

export function pgError(error: unknown): ApplicationPgError {
  let code = '',
    message = '';
  try {
    if (error instanceof ApplicationPgError) return error;
    if (typeof error === 'object' && error !== null) {
      const c = Object.getOwnPropertyDescriptor(error, 'code');
      const m = Object.getOwnPropertyDescriptor(error, 'message');
      if (c && 'value' in c && typeof c.value === 'string') code = c.value;
      if (m && 'value' in m && typeof m.value === 'string') message = m.value;
    }
  } catch {
    return new ApplicationPgError('DATABASE');
  }
  if (
    ['Query read timeout', 'timeout exceeded when trying to connect'].includes(
      message,
    )
  )
    return new ApplicationPgError('TIMEOUT');
  const state = /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
  const exact: Record<string, PgFailure> = {
    '23505': 'UNIQUE',
    '23503': 'FOREIGN_KEY',
    '23514': 'CHECK',
    '23502': 'CHECK',
    '22P02': 'CHECK',
    '22003': 'CHECK',
    '42501': 'PERMISSION',
    '25006': 'PERMISSION',
    '28P01': 'PERMISSION',
    '28000': 'PERMISSION',
    '40001': 'SERIALIZATION',
    '40P01': 'DEADLOCK',
    '55P03': 'TIMEOUT',
    '57014': 'TIMEOUT',
    '25P02': 'ABORTED',
    '25P03': 'TIMEOUT',
    '25P04': 'TIMEOUT',
    '42P01': 'SCHEMA_MISMATCH',
    '42703': 'SCHEMA_MISMATCH',
    '3F000': 'SCHEMA_MISMATCH',
  };
  return new ApplicationPgError(
    exact[code] ??
      (code.startsWith('08') ||
      [
        'ECONNREFUSED',
        'ECONNRESET',
        'ENOTFOUND',
        '57P01',
        '57P02',
        '57P03',
      ].includes(code)
        ? 'CONNECTION'
        : 'DATABASE'),
    state,
  );
}
