-- M2-R1 reviewed application schema. Explicit isolated migration only.
CREATE SCHEMA lc_app;
CREATE SCHEMA lc_meta;
REVOKE ALL ON SCHEMA lc_app, lc_meta FROM PUBLIC;

CREATE DOMAIN lc_app.object_id AS text COLLATE "C"
  CHECK (VALUE ~ '^[0-9a-f]{24}$');
CREATE DOMAIN lc_app.safe_uint AS bigint
  CHECK (VALUE BETWEEN 0 AND 9007199254740991);
CREATE DOMAIN lc_app.control_counter AS bigint
  CHECK (VALUE BETWEEN 0 AND 9007199254740990);
CREATE DOMAIN lc_app.timeline_uuid AS uuid
  CHECK (VALUE::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$');
CREATE DOMAIN lc_app.sha256 AS text COLLATE "C"
  CHECK (VALUE ~ '^[0-9a-f]{64}$');
CREATE DOMAIN lc_app.operation_id AS text COLLATE "C"
  CHECK (VALUE ~ '^[A-Za-z0-9._:-]{1,128}$');
CREATE DOMAIN lc_app.finite_float AS double precision
  CHECK (VALUE > '-Infinity'::double precision AND VALUE < 'Infinity'::double precision);
CREATE DOMAIN lc_app.metadata AS jsonb
  CHECK ((jsonb_typeof(VALUE)='object' AND VALUE->'v'='1'::jsonb
    AND jsonb_typeof(VALUE->'absent')='array'
    AND jsonb_typeof(VALUE->'null')='array'
    AND jsonb_typeof(VALUE->'bsonTypes')='object'
    AND jsonb_typeof(VALUE->'defaultProjection')='array') IS TRUE);

CREATE TABLE lc_meta.schema_migrations (
  migration_id text COLLATE "C" CONSTRAINT schema_migrations_pk PRIMARY KEY
    CHECK (migration_id ~ '^[0-9]{4}_[a-z0-9_]+$'),
  ordinal integer NOT NULL CHECK (ordinal>0),
  file_sha256 lc_app.sha256 NOT NULL,
  manifest_sha256 lc_app.sha256 NOT NULL,
  applied_at timestamptz(3) NOT NULL,
  applied_by text NOT NULL,
  runner_version text NOT NULL,
  CONSTRAINT schema_migrations_order_uq UNIQUE (ordinal)
);

CREATE TABLE lc_meta.database_identity (
  singleton boolean CONSTRAINT database_identity_pk PRIMARY KEY CHECK (singleton),
  environment text NOT NULL CHECK (environment ~ '^[a-z][a-z0-9._-]{0,63}$'),
  storage_identity text NOT NULL CHECK (storage_identity ~ '^[a-z][a-z0-9._-]{0,95}$'),
  database_instance_id lc_app.timeline_uuid NOT NULL,
  created_at timestamptz(3) NOT NULL,
  CONSTRAINT database_instance_id_uq UNIQUE (database_instance_id)
);
