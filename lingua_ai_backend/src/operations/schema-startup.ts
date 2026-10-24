import type { Model } from 'mongoose';

// Production is VERIFY ONLY. Index provisioning/legacy removal/catalog seeding
// are operator migrations, never a side effect of booting a production replica.
export function developmentSchemaChangesAllowed(): boolean {
  return process.env.NODE_ENV !== 'production';
}
export async function initializeDevelopmentIndexes(
  model: Model<any>,
): Promise<void> {
  if (developmentSchemaChangesAllowed()) await model.createIndexes();
}
