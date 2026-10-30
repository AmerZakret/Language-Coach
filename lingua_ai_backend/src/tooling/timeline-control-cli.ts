// OPERATOR_TOOL: deliberately excluded from runtime packages and Nest modules.
import { createConnection } from 'mongoose';
import { validateEnvironment } from '../config/runtime-config';
import { isTimelineId, WriteState } from '../operations/timeline-contract';
import { readTimelineControl } from '../operations/timeline-gate';
import {
  applyControlRequest,
  ControlAction,
  ControlRequest,
  OperatorControlError,
} from './timeline-control';

export function parseControlArguments(args: string[], production: boolean) {
  const [action, ...rest] = args;
  if (
    !['inspect', 'initialize', 'close', 'install-timeline', 'open'].includes(
      action,
    )
  )
    throw new Error('INVALID_ACTION');
  const options = new Map<string, string>();
  const flags = new Set<string>();
  const names = [
    'target',
    'event',
    'expected-timeline',
    'expected-state',
    'expected-version',
    'source',
    'operator',
    'confirm-database',
  ];
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (['--confirm-production', '--maintenance-isolated'].includes(key)) {
      if (flags.has(key)) throw new Error('DUPLICATE_OPTION');
      flags.add(key);
    } else {
      if (
        !names.includes(key.slice(2)) ||
        !key.startsWith('--') ||
        options.has(key) ||
        !rest[i + 1] ||
        rest[i + 1].startsWith('--')
      )
        throw new Error('INVALID_OPTION');
      options.set(key, rest[++i]);
    }
  }
  if (action === 'inspect') {
    if (rest.length) throw new Error('INSPECT_TAKES_NO_OPTIONS');
    return { action, options };
  }
  if (
    !isTimelineId(options.get('--target')) ||
    !isTimelineId(options.get('--event')) ||
    !options.get('--operator') ||
    !options.get('--confirm-database')
  )
    throw new Error('EXPLICIT_TARGET_EVENT_OPERATOR_DATABASE_REQUIRED');
  if (
    production &&
    (!flags.has('--confirm-production') || !flags.has('--maintenance-isolated'))
  )
    throw new Error('PRODUCTION_AND_MAINTENANCE_CONFIRMATION_REQUIRED');
  const version = options.get('--expected-version');
  if (version !== undefined && !/^(0|[1-9][0-9]{0,15})$/.test(version))
    throw new Error('INVALID_EXPECTED_VERSION');
  const request: ControlRequest = {
    action: action as ControlAction,
    targetTimelineId: options.get('--target')!,
    eventId: options.get('--event')!,
    operatorReference: options.get('--operator')!,
    ...(options.has('--expected-timeline')
      ? { expectedTimelineId: options.get('--expected-timeline')! }
      : {}),
    ...(options.has('--expected-state')
      ? { expectedState: options.get('--expected-state') as WriteState }
      : {}),
    ...(version !== undefined ? { expectedVersion: Number(version) } : {}),
    ...(options.has('--source')
      ? { sourceTimelineId: options.get('--source')! }
      : {}),
  };
  return { action, options, request };
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'OPERATOR_TOOL: inspect | initialize | close | install-timeline | open. No .env loading.',
    );
    console.log(
      'Mutations: --target <uuid-v4> --event <uuid-v4> --operator <public-reference> --confirm-database <name>',
    );
    console.log(
      'Transitions also require --expected-timeline <uuid-v4> --expected-state OPEN|CLOSED --expected-version <integer>. Install also requires --source <uuid-v4>.',
    );
    console.log(
      'Production mutations additionally require --confirm-production --maintenance-isolated. Keep external maintenance isolation until separate release authorization.',
    );
    return;
  }
  // Pure validation before connecting. No generated/default timeline; no .env.
  const config = validateEnvironment(process.env);
  const parsed = parseControlArguments(args, config.NODE_ENV === 'production');
  if (
    config.TIMELINE_AUTHORITY_MODE === 'DURABLE_REQUIRED' &&
    parsed.action !== 'inspect'
  )
    throw new Error('USE_DURABLE_AUTHORITY_COORDINATOR');
  const connection = createConnection(config.MONGODB_URI, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: config.READINESS_TIMEOUT_MS,
    timeoutMS: config.READINESS_TIMEOUT_MS,
  });
  try {
    await connection.asPromise();
    if (
      parsed.action !== 'inspect' &&
      parsed.options.get('--confirm-database') !== connection.name
    )
      throw new Error('DATABASE_CONFIRMATION_MISMATCH');
    if (
      parsed.action === 'open' &&
      config.CLIENT_PROTOCOL_POLICY !== 'ENFORCE_MUTATIONS'
    ) {
      const current = await readTimelineControl(
        connection,
        config.READINESS_TIMEOUT_MS,
      );
      if (current.sourceTimelineId)
        throw new OperatorControlError('RESTORE_REQUIRES_TIMELINE_ENFORCEMENT');
    }
    const row = parsed.request
      ? await applyControlRequest(
          connection,
          parsed.request,
          {
            expectedTimelineId: config.DATA_TIMELINE_ID,
            writeMode: config.DATA_WRITE_MODE,
          },
          config.READINESS_TIMEOUT_MS,
        )
      : await readTimelineControl(connection, config.READINESS_TIMEOUT_MS);
    console.log(
      JSON.stringify({
        event: `operator_timeline_${parsed.action}`,
        control: row,
      }),
    );
  } finally {
    await connection.close();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(
      error instanceof OperatorControlError
        ? error.code
        : 'TIMELINE_OPERATOR_COMMAND_FAILED; inspect configuration, confirmations and current control state.',
    );
    process.exitCode = 1;
  });
