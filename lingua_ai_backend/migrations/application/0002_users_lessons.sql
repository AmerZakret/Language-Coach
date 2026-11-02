-- M2-R1 reviewed application schema. Explicit isolated migration only.
CREATE TABLE lc_app.users (
  id lc_app.object_id CONSTRAINT users_pk PRIMARY KEY,
  name text NOT NULL CHECK (length(name)>0),
  email text COLLATE "C" NOT NULL CHECK (length(email)>0),
  password_hash text NOT NULL CHECK (length(password_hash)>0),
  is_guest boolean DEFAULT false,
  stored_level text DEFAULT 'Beginner',
  total_xp lc_app.safe_uint DEFAULT 0,
  progress_epoch lc_app.safe_uint DEFAULT 0,
  progress_write_revision lc_app.safe_uint DEFAULT 0,
  streak lc_app.safe_uint DEFAULT 0,
  target_language text DEFAULT 'en',
  xp_per_language jsonb DEFAULT '{}'::jsonb
    CHECK (xp_per_language IS NULL OR jsonb_typeof(xp_per_language)='object'),
  level_per_language jsonb DEFAULT '{}'::jsonb
    CHECK (level_per_language IS NULL OR jsonb_typeof(level_per_language)='object'),
  document_version lc_app.safe_uint DEFAULT 0,
  created_at timestamptz(3) DEFAULT clock_timestamp(),
  updated_at timestamptz(3) DEFAULT clock_timestamp(),
  legacy_meta lc_app.metadata NOT NULL DEFAULT
    '{"v":1,"absent":[],"null":[],"bsonTypes":{},"defaultProjection":[]}',
  CONSTRAINT users_email_uq UNIQUE (email)
);

CREATE TABLE lc_app.lessons (
  id lc_app.object_id CONSTRAINT lessons_pk PRIMARY KEY,
  lesson_id text COLLATE "C" NOT NULL CHECK (length(lesson_id)>0),
  target_language text NOT NULL,
  language_key text CHECK (language_key IN ('en','de','es','fr','ar')),
  title text NOT NULL, description text NOT NULL, category text NOT NULL,
  difficulty text NOT NULL, level text,
  sort_order lc_app.finite_float,
  duration lc_app.finite_float NOT NULL,
  xp_reward lc_app.safe_uint NOT NULL,
  questions jsonb DEFAULT '[]'::jsonb
    CHECK (questions IS NULL OR jsonb_typeof(questions)='array'),
  document_version lc_app.safe_uint DEFAULT 0,
  created_at timestamptz(3) DEFAULT clock_timestamp(),
  updated_at timestamptz(3) DEFAULT clock_timestamp(),
  legacy_meta lc_app.metadata NOT NULL DEFAULT
    '{"v":1,"absent":[],"null":[],"bsonTypes":{},"defaultProjection":[]}',
  CONSTRAINT lessons_logical_id_uq UNIQUE (lesson_id)
);
