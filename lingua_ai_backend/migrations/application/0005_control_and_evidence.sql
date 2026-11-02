-- M2-R1 reviewed application schema. Explicit isolated migration only.
CREATE TABLE lc_app.application_timeline_events (
  event_id lc_app.timeline_uuid CONSTRAINT application_timeline_events_pk PRIMARY KEY,
  request jsonb NOT NULL CHECK (jsonb_typeof(request)='object'),
  action text NOT NULL CHECK (action IN ('initialize','close','install-timeline','open','bind-cutover')),
  target_timeline_id lc_app.timeline_uuid NOT NULL,
  previous_timeline_id lc_app.timeline_uuid,
  result_version lc_app.control_counter NOT NULL,
  result_state text NOT NULL CHECK (result_state IN ('OPEN','CLOSED')),
  recorded_at timestamptz(3) NOT NULL,
  intent_id uuid,
  authority_revision lc_app.control_counter,
  legacy_meta lc_app.metadata NOT NULL DEFAULT
    '{"v":1,"absent":[],"null":[],"bsonTypes":{},"defaultProjection":[]}',
  CONSTRAINT application_event_projection_ck CHECK
    ((request->>'eventId'=event_id::text
      AND request->>'targetTimelineId'=target_timeline_id::text
      AND request->>'action'=action) IS TRUE)
);

CREATE TABLE lc_app.application_timeline_control (
  singleton text CONSTRAINT application_timeline_control_pk PRIMARY KEY CHECK (singleton='global'),
  data_timeline_id lc_app.timeline_uuid NOT NULL,
  write_state text NOT NULL CHECK (write_state IN ('OPEN','CLOSED')),
  control_version lc_app.control_counter NOT NULL,
  fence_version lc_app.control_counter NOT NULL,
  created_at timestamptz(3) NOT NULL,
  updated_at timestamptz(3) NOT NULL,
  last_event_id lc_app.timeline_uuid NOT NULL REFERENCES lc_app.application_timeline_events(event_id) ON DELETE RESTRICT,
  source_timeline_id lc_app.timeline_uuid,
  authority_revision_floor lc_app.control_counter NOT NULL DEFAULT 0,
  last_intent_id uuid
);

CREATE TABLE lc_app.progress_audit_repairs (
  id lc_app.object_id CONSTRAINT progress_audit_repairs_pk PRIMARY KEY,
  repair_type text NOT NULL CHECK (repair_type='derived-level-repair'),
  user_id lc_app.object_id NOT NULL REFERENCES lc_app.users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('applied','rolled-back')),
  audited_at_text text NOT NULL,
  applied_at timestamptz(3) NOT NULL,
  progress_epoch lc_app.safe_uint NOT NULL,
  progress_write_revision lc_app.safe_uint,
  language_levels_absent boolean NOT NULL,
  before_fingerprint lc_app.sha256 NOT NULL,
  after_fingerprint lc_app.sha256 NOT NULL,
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields)='array'),
  before_state jsonb NOT NULL CHECK (jsonb_typeof(before_state)='object'),
  after_state jsonb NOT NULL CHECK (jsonb_typeof(after_state)='object'),
  rolled_back_at timestamptz(3),
  legacy_meta lc_app.metadata NOT NULL DEFAULT
    '{"v":1,"absent":[],"null":[],"bsonTypes":{},"defaultProjection":[]}'
);

CREATE TABLE lc_meta.cutover_receipts (
  event_id lc_app.timeline_uuid CONSTRAINT cutover_receipts_pk PRIMARY KEY,
  intent_id uuid NOT NULL,
  source_engine text NOT NULL CHECK (source_engine IN ('mongodb','postgresql')),
  source_backup_sha256 lc_app.sha256 NOT NULL,
  source_inventory_sha256 lc_app.sha256 NOT NULL,
  target_inventory_sha256 lc_app.sha256 NOT NULL,
  schema_manifest_sha256 lc_app.sha256 NOT NULL,
  object_inventory_sha256 lc_app.sha256 NOT NULL,
  target_storage_identity text NOT NULL,
  authority_environment text NOT NULL,
  authority_storage_identity text NOT NULL,
  target_timeline_id lc_app.timeline_uuid NOT NULL,
  authority_generation lc_app.control_counter NOT NULL CHECK (authority_generation>0),
  app_control_version lc_app.control_counter NOT NULL,
  reference text NOT NULL CHECK (reference ~ '^[A-Za-z0-9._:/-]{1,96}$'),
  recorded_at timestamptz(3) NOT NULL,
  actor text NOT NULL
);
