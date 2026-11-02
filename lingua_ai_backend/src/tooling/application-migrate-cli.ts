import { applicationPgConfig } from '../persistence/pg-config';
import { migrateApplication } from '../persistence/application-migrations';
import { pgError } from '../persistence/pg-errors';

async function main() {
  if (
    process.argv.slice(2).join(' ') !==
    'apply --closed-isolated --approve-empty'
  )
    throw Error('Explicit disposable migration invocation required');
  const result = await migrateApplication(applicationPgConfig(), {
    action: 'apply-isolated-application-schema',
    reference: process.env.APPLICATION_PG_MIGRATION_REFERENCE ?? '',
    emptyTargetApproved: true,
    closedAndIsolated: true,
  });
  console.log(
    JSON.stringify({
      applied: result,
      event: 'application_schema_migration_complete',
    }),
  );
}
if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(pgError(error).message);
    process.exitCode = 1;
  });
