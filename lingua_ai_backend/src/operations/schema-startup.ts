import type { Model } from 'mongoose';

// Production is VERIFY ONLY. Index provisioning/legacy removal/catalog seeding
// are operator migrations, never a side effect of booting a production replica.
export function developmentSchemaChangesAllowed(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.TIMELINE_AUTHORITY_MODE !== 'DURABLE_REQUIRED' &&
    process.env.DEPLOYMENT_PROFILE !== 'DURABLE_REQUIRED'
  );
}
export async function initializeDevelopmentIndexes(
  model: Model<any>,
): Promise<void> {
  if (developmentSchemaChangesAllowed()) await model.createIndexes();
}
