-- Independent authority schema only. No deployment/timeline is initialized here.
CREATE SCHEMA timeline_authority;
REVOKE ALL ON SCHEMA timeline_authority FROM PUBLIC;
CREATE TABLE timeline_authority.issued (
  timeline_id uuid PRIMARY KEY,
  environment text NOT NULL,
  generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740990),
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (environment, generation), UNIQUE (timeline_id, environment)
);
CREATE TABLE timeline_authority.state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text NOT NULL CHECK (environment ~ '^[a-z][a-z0-9._-]{0,63}$'),
  storage_identity text NOT NULL CHECK (storage_identity ~ '^[a-z][a-z0-9._-]{0,95}$'),
  timeline_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740990),
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740990),
  mode text NOT NULL CHECK (mode IN ('CLOSED','MAINTENANCE','OPEN')),
  updated_at timestamptz NOT NULL,
  last_event uuid NOT NULL,
  FOREIGN KEY (timeline_id, environment) REFERENCES timeline_authority.issued(timeline_id, environment)
);
CREATE TABLE timeline_authority.audit (
  event_id uuid PRIMARY KEY,
  environment text NOT NULL,
  revision bigint NOT NULL,
  actor text NOT NULL,
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (environment, revision)
);
CREATE FUNCTION timeline_authority.immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY'; END $$;
-- Durable nontransactional-effect permits. Never expire or silently reap an
-- interrupted operation: loss of its owning connection requires isolation.
CREATE TABLE timeline_authority.file_effects (
  effect_id uuid PRIMARY KEY,
  environment text NOT NULL,
  storage_identity text NOT NULL,
  timeline_id uuid NOT NULL REFERENCES timeline_authority.issued(timeline_id),
  generation bigint NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740990),
  kind text NOT NULL CHECK (kind IN ('upload-store','upload-remove','readiness-probe')),
  owner_pid integer NOT NULL CHECK (owner_pid > 0),
  owner_start timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','SETTLED','ISOLATED')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz
);
CREATE TABLE timeline_authority.file_effect_events (
  effect_id uuid NOT NULL REFERENCES timeline_authority.file_effects(effect_id),
  status text NOT NULL CHECK (status IN ('ACTIVE','SETTLED','ISOLATED')),
  actor text NOT NULL,
  operator_event uuid,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (effect_id,status)
);
CREATE INDEX file_effects_pending ON timeline_authority.file_effects(environment) WHERE status='ACTIVE';
CREATE TABLE timeline_authority.file_isolation_receipts (
  receipt_id uuid PRIMARY KEY,
  effect_id uuid NOT NULL REFERENCES timeline_authority.file_effects(effect_id),
  environment text NOT NULL,
  storage_identity text NOT NULL,
  timeline_id uuid NOT NULL,
  generation bigint NOT NULL,
  authority_revision bigint NOT NULL,
  actor text NOT NULL,
  isolation_reference text NOT NULL,
  evidence_sha256 text NOT NULL CHECK (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER isolation_receipts_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON timeline_authority.file_isolation_receipts
FOR EACH STATEMENT EXECUTE FUNCTION timeline_authority.immutable();
CREATE TRIGGER effect_events_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON timeline_authority.file_effect_events
FOR EACH STATEMENT EXECUTE FUNCTION timeline_authority.immutable();
CREATE TRIGGER issued_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON timeline_authority.issued
FOR EACH STATEMENT EXECUTE FUNCTION timeline_authority.immutable();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON timeline_authority.audit
FOR EACH STATEMENT EXECUTE FUNCTION timeline_authority.immutable();
CREATE VIEW timeline_authority.current_state AS
SELECT s.*, NOT pg_is_in_recovery() AS is_primary,
 (SELECT count(*) FROM timeline_authority.issued i WHERE i.environment=s.environment) AS issued_count,
 (SELECT count(*) FROM timeline_authority.audit a WHERE a.environment=s.environment) AS audit_count,
 EXISTS(SELECT 1 FROM timeline_authority.issued i WHERE i.timeline_id=s.timeline_id
        AND i.environment=s.environment AND i.generation=s.generation) AS ledger_valid,
 EXISTS(SELECT 1 FROM timeline_authority.audit a WHERE a.event_id=s.last_event
        AND a.environment=s.environment AND a.revision=s.revision AND
        a.result->>'timeline_id'=s.timeline_id::text AND
         a.result->>'mode'=s.mode AND (a.result->>'generation')::bigint=s.generation) AS audit_valid,
 1 AS effect_fencing_version,
 (SELECT count(*) FROM timeline_authority.file_effects e WHERE e.status='ACTIVE') AS pending_effect_count,
 (SELECT count(*) FROM timeline_authority.file_effects e WHERE e.status='ACTIVE' AND NOT EXISTS
   (SELECT 1 FROM pg_stat_activity p WHERE p.pid=e.owner_pid AND p.backend_start=e.owner_start
    AND p.datname=current_database())) AS orphan_effect_count
FROM timeline_authority.state s;

CREATE FUNCTION timeline_authority.begin_file_effect(env text, storage text, timeline uuid,
  expected_generation bigint, id uuid, effect_kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s timeline_authority.current_state%ROWTYPE; owner_started timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(110013,1);
  SELECT * INTO s FROM timeline_authority.current_state;
  IF s.singleton IS NULL OR NOT s.is_primary OR NOT s.ledger_valid OR NOT s.audit_valid OR
     s.issued_count<>s.generation OR s.audit_count<>s.revision OR s.orphan_effect_count<>0 OR
     s.environment<>env OR s.storage_identity<>storage OR s.timeline_id<>timeline OR
     s.generation<>expected_generation OR s.mode<>'OPEN' OR s.pending_effect_count>=32 OR
     id IS NULL OR id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'FILE_EFFECT_ADMISSION_DENIED';
  END IF;
  SELECT backend_start INTO STRICT owner_started FROM pg_stat_activity WHERE pid=pg_backend_pid();
  INSERT INTO timeline_authority.file_effects(effect_id,environment,storage_identity,timeline_id,
    generation,kind,owner_pid,owner_start,status)
    VALUES(id,env,storage,timeline,expected_generation,effect_kind,pg_backend_pid(),owner_started,'ACTIVE');
  INSERT INTO timeline_authority.file_effect_events(effect_id,status,actor) VALUES(id,'ACTIVE',session_user);
END $$;

CREATE FUNCTION timeline_authority.finish_file_effect(id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  -- Deliberately no operator advisory lock: an existing effect must be able to
  -- finish while CLOSE holds that lock and blocks new admissions.
  UPDATE timeline_authority.file_effects SET status='SETTLED',finished_at=clock_timestamp()
    WHERE effect_id=id AND status='ACTIVE' AND owner_pid=pg_backend_pid() AND owner_start=
      (SELECT backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid());
  IF NOT FOUND THEN RAISE EXCEPTION 'FILE_EFFECT_OWNER_MISMATCH'; END IF;
  INSERT INTO timeline_authority.file_effect_events(effect_id,status,actor) VALUES(id,'SETTLED',session_user);
END $$;

-- Only the separate database administrator/host isolation verifier may mint
-- this receipt. The normal operator and runtime roles have no EXECUTE grant.
CREATE FUNCTION timeline_authority.record_file_isolation(id uuid, effect uuid, env text,
  storage text, expected_revision bigint, reference text, evidence text) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE s timeline_authority.state%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(110013,1);
  SELECT * INTO STRICT s FROM timeline_authority.state;
  IF s.mode<>'CLOSED' OR s.environment<>env OR s.storage_identity<>storage OR s.revision<>expected_revision OR
     coalesce(reference,'') !~ '^[A-Za-z0-9._:/-]{1,96}$' OR coalesce(evidence,'') !~ '^[0-9a-f]{64}$' OR
     EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename='timeline_reader') OR
     NOT EXISTS(SELECT 1 FROM timeline_authority.file_effects e WHERE e.effect_id=effect AND e.status='ACTIVE' AND
       NOT EXISTS(SELECT 1 FROM pg_stat_activity p WHERE p.pid=e.owner_pid AND p.backend_start=e.owner_start
         AND p.datname=current_database())) THEN
    RAISE EXCEPTION 'VERIFIED_FILE_ISOLATION_REQUIRED';
  END IF;
  INSERT INTO timeline_authority.file_isolation_receipts(receipt_id,effect_id,environment,storage_identity,
    timeline_id,generation,authority_revision,actor,isolation_reference,evidence_sha256)
    VALUES(id,effect,env,storage,s.timeline_id,s.generation,s.revision,session_user,reference,evidence);
END $$;

CREATE FUNCTION timeline_authority.transition(r jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s timeline_authority.state%ROWTYPE; previous timeline_authority.audit%ROWTYPE;
  action text := r->>'action'; env text := r->>'environment'; storage text := r->>'storageIdentity';
  target uuid; event uuid; result jsonb; next_mode text; next_generation bigint;
BEGIN
  IF jsonb_typeof(r) <> 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN
    ('action','environment','storageIdentity','timelineId','eventId','expectedRevision','operatorReference',
     'isolationReference','uploadRecoveryReference','mongoClosedVersion','effectId','effectRecoveryReference','historyContinuityReference','isolationReceiptId')) OR
    env IS NULL OR env !~ '^[a-z][a-z0-9._-]{0,63}$' OR storage IS NULL OR storage !~ '^[a-z][a-z0-9._-]{0,95}$' OR
    coalesce(r->>'operatorReference','') !~ '^[A-Za-z0-9._:/-]{1,96}$' OR
    coalesce(r->>'timelineId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    coalesce(r->>'eventId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
    coalesce(action,'') NOT IN ('initialize','close','maintenance','allocate','seal-mongo','install','reconcile','open','resolve-effect') OR
    coalesce(r->>'expectedRevision','') !~ '^(0|[1-9][0-9]{0,15})$' THEN
    RAISE EXCEPTION 'INVALID_AUTHORITY_REQUEST';
  END IF;
  target := (r->>'timelineId')::uuid; event := (r->>'eventId')::uuid;
  -- All operator coordinators take this same lock for the entire cross-store workflow.
  PERFORM pg_advisory_xact_lock(110013, 1);
  SELECT * INTO s FROM timeline_authority.state WHERE singleton FOR UPDATE;
  SELECT * INTO previous FROM timeline_authority.audit WHERE event_id=event;
  IF FOUND THEN
    IF previous.request <> r OR s.last_event IS DISTINCT FROM event OR s.revision <> previous.revision THEN
      RAISE EXCEPTION 'EVENT_RETRY_CONFLICT';
    END IF;
    RETURN previous.result;
  END IF;
  IF action='initialize' THEN
    IF s.singleton IS NOT NULL OR EXISTS(SELECT 1 FROM timeline_authority.issued) OR
       EXISTS(SELECT 1 FROM timeline_authority.audit) OR EXISTS(SELECT 1 FROM timeline_authority.file_effects) OR
       (r->>'expectedRevision')::bigint<>0 THEN
      RAISE EXCEPTION 'EXPLICIT_NEW_ENVIRONMENT_REQUIRED';
    END IF;
    INSERT INTO timeline_authority.issued VALUES(target,env,1,clock_timestamp());
    INSERT INTO timeline_authority.state VALUES(true,env,storage,target,1,1,'CLOSED',clock_timestamp(),event)
      RETURNING * INTO s;
  ELSE
    IF s.singleton IS NULL OR s.environment<>env OR s.storage_identity<>storage THEN
      RAISE EXCEPTION 'AUTHORITY_IDENTITY_MISMATCH';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM timeline_authority.current_state WHERE ledger_valid AND audit_valid
       AND issued_count=generation AND audit_count=revision AND is_primary) THEN
      RAISE EXCEPTION 'AUTHORITY_HISTORY_INVALID';
    END IF;
    IF s.revision<>(r->>'expectedRevision')::bigint THEN RAISE EXCEPTION 'AUTHORITY_CAS_CONFLICT'; END IF;
    IF action NOT IN ('close','resolve-effect') AND EXISTS
       (SELECT 1 FROM timeline_authority.file_effects WHERE status='ACTIVE') THEN
      RAISE EXCEPTION 'UNSETTLED_FILE_EFFECTS';
    END IF;
    next_generation:=s.generation;
    IF action='allocate' THEN
      IF s.mode<>'MAINTENANCE' OR target=s.timeline_id THEN RAISE EXCEPTION 'FRESH_TIMELINE_REQUIRED'; END IF;
      next_mode:='MAINTENANCE'; next_generation:=s.generation+1;
      INSERT INTO timeline_authority.issued VALUES(target,env,next_generation,clock_timestamp());
    ELSE
      IF target<>s.timeline_id THEN RAISE EXCEPTION 'AUTHORITY_TIMELINE_MISMATCH'; END IF;
      IF action='close' AND s.mode='OPEN' THEN next_mode:='CLOSED';
      ELSIF action='maintenance' AND s.mode='CLOSED' THEN next_mode:='MAINTENANCE';
      ELSIF action='install' AND s.mode='MAINTENANCE' THEN next_mode:='MAINTENANCE';
      ELSIF action='seal-mongo' AND s.mode='MAINTENANCE' THEN next_mode:='MAINTENANCE';
      ELSIF action='reconcile' AND s.mode='MAINTENANCE' THEN next_mode:='CLOSED';
      ELSIF action='open' AND s.mode='CLOSED' THEN next_mode:='OPEN';
      ELSIF action='resolve-effect' AND s.mode='CLOSED' THEN
        IF coalesce(r->>'effectId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
           coalesce(r->>'isolationReceiptId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR
           coalesce(r->>'effectRecoveryReference','') !~ '^[A-Za-z0-9._:/-]{1,96}$' THEN
          RAISE EXCEPTION 'EFFECT_RECOVERY_REQUIRED';
        END IF;
        IF NOT EXISTS(SELECT 1 FROM timeline_authority.file_isolation_receipts i WHERE
          i.receipt_id=(r->>'isolationReceiptId')::uuid AND i.effect_id=(r->>'effectId')::uuid AND
          i.environment=env AND i.storage_identity=storage AND i.timeline_id=s.timeline_id AND
          i.generation=s.generation AND i.authority_revision=s.revision) THEN
          RAISE EXCEPTION 'ADMIN_ISOLATION_RECEIPT_REQUIRED';
        END IF;
        UPDATE timeline_authority.file_effects e SET status='ISOLATED',finished_at=clock_timestamp()
          WHERE effect_id=(r->>'effectId')::uuid AND status='ACTIVE' AND e.environment=env
          AND e.storage_identity=storage AND NOT EXISTS
          (SELECT 1 FROM pg_stat_activity p WHERE p.pid=e.owner_pid AND p.backend_start=e.owner_start
           AND p.datname=current_database());
        IF NOT FOUND THEN RAISE EXCEPTION 'EFFECT_OWNER_STILL_LIVE_OR_UNKNOWN'; END IF;
        INSERT INTO timeline_authority.file_effect_events(effect_id,status,actor,operator_event)
          VALUES((r->>'effectId')::uuid,'ISOLATED',session_user,event);
        next_mode:='CLOSED';
      ELSE RAISE EXCEPTION 'ILLEGAL_AUTHORITY_TRANSITION'; END IF;
    END IF;
    IF action IN ('maintenance','allocate','seal-mongo','install','reconcile','open','resolve-effect') AND
       coalesce(r->>'isolationReference','') !~ '^[A-Za-z0-9._:/-]{1,96}$' THEN
      RAISE EXCEPTION 'ISOLATION_EVIDENCE_REQUIRED';
    END IF;
    IF action IN ('maintenance','allocate','install','reconcile','resolve-effect') AND
       coalesce(r->>'mongoClosedVersion','') !~ '^(0|[1-9][0-9]{0,15})$' THEN
      RAISE EXCEPTION 'MONGO_CLOSED_BARRIER_REQUIRED';
    END IF;
    IF action IN ('reconcile','open') AND
       coalesce(r->>'uploadRecoveryReference','') !~ '^[A-Za-z0-9._:/-]{1,96}$' THEN
      RAISE EXCEPTION 'UPLOAD_RECOVERY_EVIDENCE_REQUIRED';
    END IF;
    IF action IN ('reconcile','open') AND
       coalesce(r->>'historyContinuityReference','') !~ '^[A-Za-z0-9._:/-]{1,96}$' THEN
      RAISE EXCEPTION 'INDEPENDENT_HISTORY_EVIDENCE_REQUIRED';
    END IF;
    UPDATE timeline_authority.state SET timeline_id=target,generation=next_generation,
      revision=revision+1,mode=next_mode,updated_at=clock_timestamp(),last_event=event
      WHERE singleton RETURNING * INTO s;
  END IF;
  result:=to_jsonb(s);
  INSERT INTO timeline_authority.audit(event_id,environment,revision,actor,request,result)
    VALUES(event,env,s.revision,session_user,r,result);
  RETURN result;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA timeline_authority FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA timeline_authority FROM PUBLIC;
GRANT USAGE ON SCHEMA timeline_authority TO timeline_reader,timeline_operator;
GRANT SELECT ON timeline_authority.current_state TO timeline_reader,timeline_operator;
GRANT SELECT ON timeline_authority.audit,timeline_authority.issued TO timeline_operator;
GRANT SELECT ON timeline_authority.file_effects,timeline_authority.file_effect_events,timeline_authority.file_isolation_receipts TO timeline_operator;
GRANT EXECUTE ON FUNCTION timeline_authority.transition(jsonb) TO timeline_operator;
GRANT EXECUTE ON FUNCTION timeline_authority.begin_file_effect(text,text,uuid,bigint,uuid,text),
  timeline_authority.finish_file_effect(uuid) TO timeline_reader;
-- Database owners/superusers can defeat triggers: protect this separate control plane and backups.
