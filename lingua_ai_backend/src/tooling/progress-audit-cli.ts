import { createWriteStream } from 'node:fs';
import { mongo } from 'mongoose';
import { AuditOptions, objectId, ProgressAuditTool } from './progress-audit';

export interface CliOptions extends AuditOptions {
  apply: boolean;
  output?: string;
  rollback?: string;
  help: boolean;
}
export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    apply: false,
    limit: 100,
    batchSize: 100,
    help: false,
  };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error('Duplicate option');
    seen.add(flag);
    if (flag === '--apply') options.apply = true;
    else if (flag === '--all') options.limit = null;
    else if (flag === '--help') options.help = true;
    else if (
      [
        '--user',
        '--after',
        '--limit',
        '--batch-size',
        '--output',
        '--rollback',
      ].includes(flag)
    ) {
      const value = args[++i];
      if (!value || value.startsWith('--'))
        throw new Error('Missing option value');
      if (flag === '--user') {
        objectId(value);
        options.userId = value.toLowerCase();
      }
      if (flag === '--after') {
        objectId(value);
        options.after = value.toLowerCase();
      }
      if (flag === '--output') options.output = value;
      if (flag === '--rollback') {
        objectId(value);
        options.rollback = value;
      }
      if (flag === '--limit' || flag === '--batch-size') {
        if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
          throw new Error('Invalid execution bound');
        if (flag === '--limit') options.limit = Number(value);
        else options.batchSize = Number(value);
      }
    } else throw new Error('Unknown option');
  }
  if (options.batchSize > 500)
    throw new Error('Batch size must be between 1 and 500');
  if (seen.has('--all') && seen.has('--limit'))
    throw new Error('Choose --all or --limit');
  if (options.userId && options.after)
    throw new Error('Choose --user or --after');
  if (
    options.rollback &&
    (!options.apply ||
      options.userId ||
      options.after ||
      seen.has('--all') ||
      seen.has('--limit'))
  ) {
    throw new Error(
      'Rollback requires --apply and cannot be combined with audit filters',
    );
  }
  if (options.apply && !options.output)
    throw new Error('Apply requires an explicit new --output file');
  return options;
}

export const USAGE = `Progress integrity audit (JSON Lines; read-only by default)
Build first: npm run build
Run: node dist/src/tooling/progress-audit-cli.js [options]
MONGODB_URI must be supplied explicitly in the environment. No .env is loaded.
--user ID           Audit one MongoDB owner (never email)
--limit N           Audit at most N owners (default 100)
--all               Stream all owners and orphan references
--after ID          Resume owner scan after this MongoDB ID
--batch-size N      Driver batch size, 1-500 (default 100)
--output FILE       New JSONL report file; refuses to overwrite existing files
--apply             Optional transactional derived-level repair only
--rollback ID       With --apply: restore a receipt only if the owner is unchanged
--help              Show usage without connecting
Mixed alias scopes and all XP/ownership/completion repair remain manual.
Apply/rollback require transaction-capable MongoDB and operator authorization.`;

export async function main(args = process.argv.slice(2)): Promise<void> {
  // Parse every option before opening files or connecting to any database.
  const options = parseArgs(args);
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  const output = options.output
    ? createWriteStream(options.output, { flags: 'wx', mode: 0o600 })
    : process.stdout;
  let outputError: Error | undefined;
  const onError = (error: Error) => {
    outputError = error;
  };
  output.on('error', onError);
  const emit = async (record: unknown) => {
    if (outputError) throw outputError;
    const line = JSON.stringify(
      mongo.BSON.EJSON.serialize(record, { relaxed: false }),
    );
    await new Promise<void>((resolve, reject) =>
      output.write(`${line}\n`, (error) => (error ? reject(error) : resolve())),
    );
  };
  const client = new mongo.MongoClient(uri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 3,
  });
  try {
    if (options.output)
      await new Promise<void>((resolve, reject) => {
        output.once('open', () => resolve());
        output.once('error', reject);
      });
    await client.connect();
    const tool = new ProgressAuditTool(client, client.db());
    await emit({
      type: 'header',
      version: 1,
      startedAt: new Date().toISOString(),
      mode: options.apply ? 'apply' : 'dry-run',
      scope: {
        userId: options.userId ?? null,
        after: options.after ?? null,
        limit: options.limit,
        batchSize: options.batchSize,
      },
    });
    if (options.rollback)
      await emit(
        await tool.rollback(options.rollback, { apply: options.apply }),
      );
    else {
      const result = await tool.run(options, emit, options.apply, (users) =>
        process.stderr.write(`Audited owners: ${users}\n`),
      );
      if (result.failedUsers) process.exitCode = 1;
    }
  } finally {
    await client.close();
    if (options.output)
      await new Promise<void>((resolve, reject) => {
        if (outputError) {
          output.destroy();
          reject(outputError);
          return;
        }
        output.end(() => resolve());
      });
    output.removeListener('error', onError);
  }
}

if (require.main === module)
  void main().catch(() => {
    // Never print a driver exception, URI or raw document to operator logs.
    process.stderr.write(
      'Progress audit failed. Check options, report path, database access and transaction support. No repair is inferred.\n',
    );
    process.exitCode = 1;
  });
