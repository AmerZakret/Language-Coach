-- M2-R1 reviewed application schema. Explicit isolated migration only.
CREATE TABLE lc_app.progresses (
  id lc_app.object_id CONSTRAINT progresses_pk PRIMARY KEY,
  user_id lc_app.object_id NOT NULL REFERENCES lc_app.users(id) ON DELETE RESTRICT,
  lesson_id text COLLATE "C" NOT NULL REFERENCES lc_app.lessons(lesson_id) ON DELETE RESTRICT,
  status text DEFAULT 'completed',
  score lc_app.finite_float NOT NULL,
  target_language text,
  language_key text CHECK (language_key IN ('en','de','es','fr','ar')),
  awarded_xp lc_app.safe_uint,
  progress_epoch lc_app.safe_uint,
  document_version lc_app.safe_uint DEFAULT 0,
  created_at timestamptz(3) DEFAULT clock_timestamp(),
  updated_at timestamptz(3) DEFAULT clock_timestamp(),
  legacy_meta lc_app.metadata NOT NULL DEFAULT
    '{"v":1,"absent":[],"null":[],"bsonTypes":{},"defaultProjection":[]}',
  CONSTRAINT progresses_owner_lesson_uq UNIQUE (user_id,lesson_id)
);

CREATE TABLE lc_app.progress_resets (
  id lc_app.object_id CONSTRAINT progress_resets_pk PRIMARY KEY,
  user_id lc_app.object_id NOT NULL REFERENCES lc_app.users(id) ON DELETE RESTRICT,
  operation_id lc_app.operation_id NOT NULL,
  expected_epoch lc_app.safe_uint NOT NULL,
  progress_epoch lc_app.safe_uint NOT NULL,
  data_timeline_id lc_app.timeline_uuid,
  document_version lc_app.safe_uint DEFAULT 0,
  created_at timestamptz(3) DEFAULT clock_timestamp(),
  updated_at timestamptz(3) DEFAULT clock_timestamp(),
  legacy_meta lc_app.metadata NOT NULL DEFAULT
    '{"v":1,"absent":[],"null":[],"bsonTypes":{},"defaultProjection":[]}',
  CONSTRAINT progress_resets_owner_op_uq UNIQUE (user_id,operation_id),
  CONSTRAINT progress_resets_increment_ck CHECK (progress_epoch=expected_epoch+1)
);

CREATE TABLE lc_app.flashcards (
  id lc_app.object_id CONSTRAINT flashcards_pk PRIMARY KEY,
  user_id lc_app.object_id NOT NULL REFERENCES lc_app.users(id) ON DELETE RESTRICT,
  target_word text COLLATE "C" NOT NULL,
  turkish_translation text NOT NULL,
  target_language text COLLATE "C",
  language_key text CHECK (language_key IN ('en','de','es','fr','ar')),
  native_language text, native_translation text, example_sentence text, note text,
  review_interval lc_app.finite_float DEFAULT 0,
  easiness_factor lc_app.finite_float DEFAULT 2.5,
  next_review_date timestamptz(3) DEFAULT clock_timestamp(),
  review_count lc_app.safe_uint DEFAULT 0,
  history jsonb DEFAULT '[]'::jsonb CHECK (history IS NULL OR jsonb_typeof(history)='array'),
  ai_context jsonb,
  document_version lc_app.safe_uint DEFAULT 0,
  created_at timestamptz(3) DEFAULT clock_timestamp(),
  updated_at timestamptz(3) DEFAULT clock_timestamp(),
  legacy_meta lc_app.metadata NOT NULL DEFAULT
    '{"v":1,"absent":[],"null":[],"bsonTypes":{},"defaultProjection":[]}',
  CONSTRAINT flashcards_owner_raw_word_uq
    UNIQUE NULLS NOT DISTINCT (user_id,target_language,target_word)
);

CREATE TABLE lc_app.flashcard_operations (
  id lc_app.object_id CONSTRAINT flashcard_operations_pk PRIMARY KEY,
  user_id lc_app.object_id NOT NULL REFERENCES lc_app.users(id) ON DELETE RESTRICT,
  operation_id lc_app.operation_id NOT NULL,
  operation_type text COLLATE "C" NOT NULL CHECK (operation_type IN
    ('create-flashcard','update-flashcard','delete-flashcard','review-flashcard')),
  request_hash lc_app.sha256 NOT NULL,
  resource_id lc_app.object_id NOT NULL,
  data_timeline_id lc_app.timeline_uuid,
  document_version lc_app.safe_uint DEFAULT 0,
  created_at timestamptz(3) DEFAULT clock_timestamp(),
  updated_at timestamptz(3) DEFAULT clock_timestamp(),
  legacy_meta lc_app.metadata NOT NULL DEFAULT
    '{"v":1,"absent":[],"null":[],"bsonTypes":{},"defaultProjection":[]}',
  CONSTRAINT flashcard_operations_identity_uq UNIQUE (user_id,operation_id,operation_type)
);

CREATE TABLE lc_app.mutation_receipts (
  id lc_app.object_id CONSTRAINT mutation_receipts_pk PRIMARY KEY,
  user_id lc_app.object_id NOT NULL REFERENCES lc_app.users(id) ON DELETE RESTRICT,
  operation_type text COLLATE "C" NOT NULL CHECK (operation_type IN
    ('community-create','community-update','community-delete','community-reaction','ai-send','ai-clear')),
  operation_id lc_app.operation_id NOT NULL,
  request_hash lc_app.sha256 NOT NULL,
  result jsonb,
  data_timeline_id lc_app.timeline_uuid,
  document_version lc_app.safe_uint DEFAULT 0,
  created_at timestamptz(3) DEFAULT clock_timestamp(),
  updated_at timestamptz(3) DEFAULT clock_timestamp(),
  legacy_meta lc_app.metadata NOT NULL DEFAULT
    '{"v":1,"absent":[],"null":[],"bsonTypes":{},"defaultProjection":[]}',
  CONSTRAINT mutation_receipts_identity_uq UNIQUE (user_id,operation_type,operation_id)
);
