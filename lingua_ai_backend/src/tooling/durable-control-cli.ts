// OPERATOR_TOOL: explicit disposable target only; no .env loading or public API.
import { readFileSync } from 'node:fs';
import { createConnection } from 'mongoose';
import { validateEnvironment } from '../config/runtime-config';
import {
  AuthorityOperator,
  AuthorityRequest,
  coordinateAuthority,
} from './durable-control';

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'durable-control-cli --request <public-plan.json> --confirm-environment <identity> [--new-environment]',
    );
    return;
  }
  if (
    args[0] !== '--request' ||
    args[2] !== '--confirm-environment' ||
    ![4, 5].includes(args.length) ||
    (args.length === 5 && args[4] !== '--new-environment')
  )
    throw new Error('EXPLICIT_REQUEST_REQUIRED');
  const config = validateEnvironment(process.env);
  const r = JSON.parse(readFileSync(args[1], 'utf8')) as AuthorityRequest;
  if (
    process.env.AUTHORITY_OPERATOR_INTENT !==
      'I_ACKNOWLEDGE_DISPOSABLE_AUTHORITY' ||
    config.TIMELINE_AUTHORITY_MODE !== 'DURABLE_REQUIRED' ||
    args[3] !== r.environment ||
    config.MONGODB_URI !==
      'mongodb://mongo:27017/lingua_staging?replicaSet=staging-rs'
  )
    throw new Error('DISPOSABLE_OPERATOR_AUTHORIZATION_REQUIRED');
  const url = new URL(process.env.AUTHORITY_OPERATOR_URL || '');
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== 'authority' ||
    url.port !== '5432' ||
    url.pathname !== '/timeline_authority' ||
    url.username !== 'timeline_operator' ||
    !url.password ||
    url.search ||
    url.hash
  )
    throw new Error('DISPOSABLE_AUTHORITY_REQUIRED');
  const op = new AuthorityOperator(url.toString(), config.READINESS_TIMEOUT_MS);
  const mongo = createConnection(config.MONGODB_URI, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: config.READINESS_TIMEOUT_MS,
    timeoutMS: config.READINESS_TIMEOUT_MS,
  });
  try {
    await Promise.all([op.connect(), mongo.asPromise()]);
    const state = await coordinateAuthority(op, mongo, r, {
      environment: String(config.TIMELINE_AUTHORITY_ENVIRONMENT),
      storageIdentity: String(config.TIMELINE_AUTHORITY_STORAGE_ID),
      newEnvironment: args[4] === '--new-environment',
      uploadRoot: config.UPLOAD_ROOT,
      deploymentTimeline: config.DATA_TIMELINE_ID,
      deploymentGeneration: Number(config.TIMELINE_AUTHORITY_GENERATION),
      writeMode: config.DATA_WRITE_MODE,
      protocolPolicy: config.CLIENT_PROTOCOL_POLICY,
    });
    console.log(JSON.stringify({ event: 'durable_operator_completed', state }));
  } finally {
    await Promise.all([op.close(), mongo.close()]);
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'DURABLE_OPERATOR_FAILED; remain isolated, inspect nonsecret state and retry the identical plan.',
    );
    process.exitCode = 1;
  });
