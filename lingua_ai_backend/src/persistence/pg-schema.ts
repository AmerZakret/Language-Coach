import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ClientBase } from 'pg';
import type { ApplicationPgConfig } from './pg-config';
import { ApplicationPgError } from './pg-errors';

export interface MigrationEntry {
  id: string;
  ordinal: number;
  sha256: string;
  transaction: 'required';
  previous: string | null;
  catalogSha256: string;
}
export interface MigrationManifest {
  format: 1;
  serverMajor: 17;
  encodingVersion: 'LC-PG-TEXT-1';
  review: string;
  minimumRuntime: string;
  roles: string[];
  previousManifest: null;
  entries: MigrationEntry[];
}
export const sha256 = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex');
export const applicationMigrationDirectory = () =>
  resolve(
    __dirname,
    /[\\/]dist[\\/]src[\\/]persistence$/.test(__dirname)
      ? '../../../migrations/application'
      : '../../migrations/application',
  );

export function loadApplicationManifest(
  directory = applicationMigrationDirectory(),
) {
  const fail = (): never => {
    throw new ApplicationPgError('SCHEMA_MISMATCH');
  };
  try {
    if (lstatSync(directory).isSymbolicLink()) return fail();
    if (lstatSync(resolve(directory, 'manifest.json')).isSymbolicLink())
      return fail();
    const raw = readFileSync(resolve(directory, 'manifest.json'));
    if (!Buffer.from(raw.toString('utf8'), 'utf8').equals(raw)) return fail();
    const manifest = JSON.parse(raw.toString('utf8')) as MigrationManifest;
    if (
      manifest.format !== 1 ||
      manifest.serverMajor !== 17 ||
      manifest.encodingVersion !== 'LC-PG-TEXT-1' ||
      manifest.review !== 'M2-R1-M3-A' ||
      manifest.minimumRuntime !== 'm3-a-foundation' ||
      manifest.previousManifest !== null ||
      JSON.stringify(manifest.roles) !==
        JSON.stringify([
          'lc_app_owner',
          'lc_app_migrator',
          'lc_app_runtime',
          'lc_app_reference',
          'lc_app_probe',
          'lc_app_operator',
          'lc_app_audit',
        ]) ||
      !Array.isArray(manifest.entries) ||
      manifest.entries.length !== 6
    )
      return fail();
    const expectedFiles = ['manifest.json'];
    const statements: Record<string, string> = Object.create(null) as Record<
      string,
      string
    >;
    for (const [index, entry] of manifest.entries.entries()) {
      if (
        !/^000[1-6]_[a-z_]+$/.test(entry.id) ||
        entry.ordinal !== index + 1 ||
        entry.id.slice(0, 4) !== String(index + 1).padStart(4, '0') ||
        entry.transaction !== 'required' ||
        entry.previous !==
          (index === 0 ? null : manifest.entries[index - 1].id) ||
        !/^[0-9a-f]{64}$/.test(entry.sha256) ||
        !/^[0-9a-f]{64}$/.test(entry.catalogSha256)
      )
        return fail();
      const filename = entry.id + '.sql';
      const path = resolve(directory, filename);
      if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
        return fail();
      const bytes = readFileSync(path);
      const sql = bytes.toString('utf8');
      if (
        bytes.includes(13) ||
        bytes.includes(0) ||
        sql.startsWith('\ufeff') ||
        !Buffer.from(sql, 'utf8').equals(bytes) ||
        sha256(bytes) !== entry.sha256
      )
        return fail();
      statements[entry.id] = sql;
      Object.freeze(entry);
      expectedFiles.push(filename);
    }
    if (
      JSON.stringify(readdirSync(directory).sort()) !==
      JSON.stringify(expectedFiles.sort())
    )
      return fail();
    Object.freeze(manifest.entries);
    Object.freeze(manifest.roles);
    Object.freeze(manifest);
    return Object.freeze({
      manifest,
      digest: sha256(raw),
      directory,
      statements: Object.freeze(statements),
    });
  } catch {
    return fail();
  }
}

// A provisioning attestation lives outside lc_app/lc_meta so the first migration
// can verify an explicitly provisioned empty target. It is NOT authority proof.
export async function verifyApplicationTarget(
  client: ClientBase,
  config: ApplicationPgConfig,
) {
  const result = await client.query<{
    database: string;
    database_owner: string;
    role: string;
    current_role: string;
    version: number;
    recovery: boolean;
    authority: boolean;
    marker: string | null;
    superuser: boolean;
    create_role: boolean;
    create_database: boolean;
    replication: boolean;
    bypass_rls: boolean;
    owner_member: boolean;
    read_only: boolean;
    durable: boolean;
    ddl_privilege: boolean;
  }>(`SELECT current_database() AS database,pg_get_userbyid(d.datdba) AS database_owner, session_user AS role,current_user AS current_role,
    current_setting('server_version_num')::integer AS version, pg_is_in_recovery() AS recovery,
    to_regnamespace('timeline_authority') IS NOT NULL AS authority,
    shobj_description(d.oid,'pg_database') AS marker,
    r.rolsuper AS superuser,r.rolcreaterole AS create_role,r.rolcreatedb AS create_database,
    r.rolreplication AS replication,r.rolbypassrls AS bypass_rls,
    pg_has_role(session_user,'lc_app_owner','MEMBER') AS owner_member,
    current_setting('default_transaction_read_only')='on' AS read_only,
    (current_setting('fsync')='on' AND current_setting('full_page_writes')='on' AND current_setting('synchronous_commit')='on') AS durable,
    (has_schema_privilege(session_user,'public','CREATE') OR has_database_privilege(session_user,current_database(),'CREATE') OR has_database_privilege(session_user,current_database(),'TEMP')) AS ddl_privilege
    FROM pg_database d JOIN pg_roles r ON r.rolname=session_user WHERE d.datname=current_database()`);
  const row = result.rows[0];
  const roleBoundary = await client.query<{
    invalid: string;
    profiles: string;
    memberships: unknown;
  }>(`SELECT
    (SELECT count(*)::text FROM pg_roles WHERE rolname IN ('lc_app_owner','lc_app_migrator','lc_app_runtime','lc_app_reference','lc_app_probe','lc_app_operator','lc_app_audit')) AS profiles,
    (SELECT count(*) FROM pg_roles r WHERE r.rolname IN ('lc_app_owner','lc_app_migrator','lc_app_runtime','lc_app_reference','lc_app_probe','lc_app_operator','lc_app_audit') AND
      (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR
       r.rolcanlogin<>(r.rolname<>'lc_app_owner') OR (r.rolname='lc_app_migrator' AND r.rolinherit) OR
       r.rolconnlimit<>CASE r.rolname WHEN 'lc_app_owner' THEN -1 WHEN 'lc_app_runtime' THEN 12 WHEN 'lc_app_probe' THEN 1 ELSE 2 END))::text AS invalid,
    (SELECT coalesce(json_agg(json_build_object('member',child.rolname,'role',parent.rolname,'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) ORDER BY child.rolname,parent.rolname),'[]'::json)
      FROM pg_auth_members m JOIN pg_roles child ON child.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
      WHERE child.rolname IN ('lc_app_owner','lc_app_migrator','lc_app_runtime','lc_app_reference','lc_app_probe','lc_app_operator','lc_app_audit')) AS memberships`);
  const globalDefaults = await client.query<{
    kind: string;
    acl: string;
  }>(`SELECT defaclobjtype AS kind,defaclacl::text AS acl
    FROM pg_default_acl WHERE defaclrole='lc_app_owner'::regrole AND defaclnamespace=0 ORDER BY defaclobjtype`);
  let marker: unknown;
  try {
    marker = JSON.parse(row?.marker ?? 'null');
  } catch {
    marker = null;
  }
  const expected = {
    purpose: 'language-coach-application-foundation',
    database: config.database,
    ...config.identity,
  };
  if (
    !row ||
    row.database !== config.database ||
    row.database_owner !== 'lc_app_owner' ||
    roleBoundary.rows[0].profiles !== '7' ||
    row.role !== config.role ||
    ![
      config.role,
      ...(config.role === 'lc_app_migrator' ? ['lc_app_owner'] : []),
    ].includes(row.current_role) ||
    roleBoundary.rows[0].invalid !== '0' ||
    JSON.stringify(roleBoundary.rows[0].memberships) !==
      JSON.stringify([
        {
          member: 'lc_app_migrator',
          role: 'lc_app_owner',
          admin: false,
          inherit: false,
          set: true,
        },
      ]) ||
    row.authority ||
    row.recovery ||
    row.version < 170000 ||
    row.version >= 180000 ||
    row.superuser ||
    row.create_role ||
    row.create_database ||
    row.replication ||
    row.bypass_rls ||
    row.read_only ||
    !row.durable ||
    (config.role !== 'lc_app_migrator' && row.ddl_privilege) ||
    row.owner_member !== (config.role === 'lc_app_migrator') ||
    JSON.stringify(marker) !== JSON.stringify(expected) ||
    JSON.stringify(globalDefaults.rows) !==
      JSON.stringify([{ kind: 'f', acl: '{lc_app_owner=X/lc_app_owner}' }])
  )
    throw new ApplicationPgError('IDENTITY');
}

/** Reject non-reviewed object families before querying application metadata rows. */
export async function verifyApplicationCatalogScope(client: ClientBase) {
  const result = await client.query<{ count: string }>(`SELECT (
    (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','lc_app','lc_meta','information_schema') AND nspname !~ '^pg_') +
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') +
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') +
    (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') +
    (SELECT count(*) FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace WHERE n.nspname IN ('lc_app','lc_meta','public')) +
    (SELECT count(*) FROM pg_conversion c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('lc_app','lc_meta','public')) +
    (SELECT count(*) FROM pg_operator o JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE n.nspname IN ('lc_app','lc_meta','public')) +
    (SELECT count(*) FROM pg_opclass o JOIN pg_namespace n ON n.oid=o.opcnamespace WHERE n.nspname IN ('lc_app','lc_meta','public')) +
    (SELECT count(*) FROM pg_opfamily o JOIN pg_namespace n ON n.oid=o.opfnamespace WHERE n.nspname IN ('lc_app','lc_meta','public')) +
    (SELECT count(*) FROM pg_statistic_ext o JOIN pg_namespace n ON n.oid=o.stxnamespace WHERE n.nspname IN ('lc_app','lc_meta','public')) +
    (SELECT count(*) FROM pg_ts_config o JOIN pg_namespace n ON n.oid=o.cfgnamespace WHERE n.nspname IN ('lc_app','lc_meta','public')) +
    (SELECT count(*) FROM pg_ts_dict o JOIN pg_namespace n ON n.oid=o.dictnamespace WHERE n.nspname IN ('lc_app','lc_meta','public')) +
    (SELECT count(*) FROM pg_ts_parser o JOIN pg_namespace n ON n.oid=o.prsnamespace WHERE n.nspname IN ('lc_app','lc_meta','public')) +
    (SELECT count(*) FROM pg_ts_template o JOIN pg_namespace n ON n.oid=o.tmplnamespace WHERE n.nspname IN ('lc_app','lc_meta','public')) +
    (SELECT count(*) FROM pg_extension WHERE extname<>'plpgsql') + (SELECT count(*) FROM pg_event_trigger)
    )::text AS count`);
  if (result.rows[0].count !== '0')
    throw new ApplicationPgError('SCHEMA_MISMATCH');
}

// Deterministic per-prefix catalog seal. No data, environment-specific OIDs,
// identity values or migration rows are hashed. Includes ACLs/owner/functions,
// constraints/index validity, triggers, domain validation and column defaults.
export async function applicationCatalogDigest(
  client: ClientBase,
): Promise<string> {
  await verifyApplicationCatalogScope(client);
  // The initial reviewed schema has no policies, enums/ranges/custom base types.
  // Check default function privileges separately so future objects cannot regain
  // PUBLIC execution while the existing-object seal still appears unchanged.
  const extras = await client.query<{ count: string }>(`SELECT
    (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('lc_app','lc_meta')) +
    (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('lc_app','lc_meta') AND t.typtype NOT IN ('c','d') AND NOT(t.typtype='b' AND t.typelem<>0)) AS count`);
  const defaults = await client.query<{
    schema: string;
    role: string;
    kind: string;
    acl: string;
  }>(`SELECT n.nspname AS schema,pg_get_userbyid(d.defaclrole) AS role,d.defaclobjtype AS kind,d.defaclacl::text AS acl
    FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname IN ('lc_app','lc_meta') ORDER BY n.nspname`);
  if (extras.rows[0].count !== '0' || defaults.rowCount !== 0)
    throw new ApplicationPgError('SCHEMA_MISMATCH');
  const result = await client.query<{ item: string }>(`
    SELECT item FROM (
      SELECT jsonb_build_array('schema',n.nspname,pg_get_userbyid(n.nspowner),n.nspacl::text)::text AS item
        FROM pg_namespace n WHERE n.nspname IN ('lc_app','lc_meta')
      UNION ALL
      SELECT jsonb_build_array('relation',n.nspname,c.relname,c.relkind,pg_get_userbyid(c.relowner),c.relacl::text,c.relrowsecurity,c.relforcerowsecurity)::text
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('lc_app','lc_meta')
      UNION ALL
      SELECT jsonb_build_array('column',n.nspname,c.relname,a.attname,a.attnum,format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid),a.attidentity,a.attgenerated,a.attacl::text,co.collname)::text
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum LEFT JOIN pg_collation co ON co.oid=a.attcollation
        WHERE n.nspname IN ('lc_app','lc_meta') AND a.attnum>0 AND NOT a.attisdropped
      UNION ALL
      SELECT jsonb_build_array('constraint',n.nspname,co.conname,co.contype,co.convalidated,co.condeferrable,co.condeferred,pg_get_constraintdef(co.oid,true))::text
        FROM pg_constraint co JOIN pg_namespace n ON n.oid=co.connamespace WHERE n.nspname IN ('lc_app','lc_meta')
      UNION ALL
      SELECT jsonb_build_array('index',n.nspname,c.relname,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid))::text
        FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('lc_app','lc_meta')
      UNION ALL
      SELECT jsonb_build_array('function',n.nspname,p.proname,pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner),p.proacl::text)::text
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('lc_app','lc_meta')
      UNION ALL
      SELECT jsonb_build_array('trigger',n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid,true))::text
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('lc_app','lc_meta') AND NOT t.tgisinternal
      UNION ALL
      SELECT jsonb_build_array('domain',n.nspname,t.typname,format_type(t.typbasetype,t.typtypmod),t.typnotnull,t.typdefault,pg_get_userbyid(t.typowner),t.typacl::text)::text
        FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname IN ('lc_app','lc_meta') AND t.typtype='d'
    ) inventory ORDER BY item COLLATE "C"`);
  return sha256(JSON.stringify(result.rows.map((row) => row.item)));
}

export async function verifyApplicationSchema(
  client: ClientBase,
  config: ApplicationPgConfig,
  directory?: string,
) {
  const loaded = loadApplicationManifest(directory);
  await verifyApplicationTarget(client, config);
  // A forged identity/history view must never execute before structural proof.
  if (
    (await applicationCatalogDigest(client)) !==
    loaded.manifest.entries.at(-1)!.catalogSha256
  )
    throw new ApplicationPgError('SCHEMA_MISMATCH');
  const identity = await client.query<{
    environment: string;
    storage_identity: string;
    database_instance_id: string;
  }>(
    'SELECT environment,storage_identity,database_instance_id FROM lc_meta.database_identity WHERE singleton',
  );
  const row = identity.rows[0];
  if (
    identity.rowCount !== 1 ||
    row.environment !== config.identity?.environment ||
    row.storage_identity !== config.identity.storageIdentity ||
    row.database_instance_id !== config.identity.databaseInstanceId
  )
    throw new ApplicationPgError('IDENTITY');
  const history = await client.query<{
    migration_id: string;
    ordinal: number;
    file_sha256: string;
    manifest_sha256: string;
  }>(
    'SELECT migration_id,ordinal,file_sha256,manifest_sha256 FROM lc_meta.schema_migrations ORDER BY ordinal',
  );
  if (
    history.rowCount !== loaded.manifest.entries.length ||
    history.rows.some(
      (r, i) =>
        r.migration_id !== loaded.manifest.entries[i].id ||
        r.ordinal !== i + 1 ||
        r.file_sha256 !== loaded.manifest.entries[i].sha256 ||
        r.manifest_sha256 !== loaded.digest,
    )
  )
    throw new ApplicationPgError('SCHEMA_MISMATCH');
  return loaded.manifest.entries.at(-1)!.id;
}
