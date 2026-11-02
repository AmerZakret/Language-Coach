-- M2-R1 reviewed application schema. Explicit isolated migration only.
CREATE TABLE lc_app.community_posts (
  id lc_app.object_id CONSTRAINT community_posts_pk PRIMARY KEY,
  user_id lc_app.object_id NOT NULL REFERENCES lc_app.users(id) ON DELETE RESTRICT,
  stored_user_name text NOT NULL,
  learning_language text NOT NULL,
  language_key text CHECK (language_key IN ('en','de','es','fr','ar')),
  body_text text, image_url text,
  revision lc_app.safe_uint DEFAULT 0,
  document_version lc_app.safe_uint DEFAULT 0,
  created_at timestamptz(3) DEFAULT clock_timestamp(),
  updated_at timestamptz(3) DEFAULT clock_timestamp(),
  legacy_meta lc_app.metadata NOT NULL DEFAULT
    '{"v":1,"absent":[],"null":[],"bsonTypes":{},"defaultProjection":[]}',
  CONSTRAINT community_posts_content_ck
    CHECK (coalesce(length(body_text),0)>0 OR coalesce(length(image_url),0)>0)
);

CREATE TABLE lc_app.community_likes (
  post_id lc_app.object_id NOT NULL REFERENCES lc_app.community_posts(id) ON DELETE CASCADE,
  user_id lc_app.object_id NOT NULL REFERENCES lc_app.users(id) ON DELETE RESTRICT,
  ordinal lc_app.safe_uint NOT NULL,
  CONSTRAINT community_likes_pk PRIMARY KEY (post_id,user_id),
  CONSTRAINT community_likes_order_uq UNIQUE (post_id,ordinal)
);

CREATE TABLE lc_app.chat_messages (
  id lc_app.object_id CONSTRAINT chat_messages_pk PRIMARY KEY,
  user_id lc_app.object_id NOT NULL REFERENCES lc_app.users(id) ON DELETE RESTRICT,
  target_language text NOT NULL,
  language_key text CHECK (language_key IN ('en','de','es','fr','ar')),
  role text NOT NULL CHECK (role IN ('user','assistant')),
  message text NOT NULL,
  document_version lc_app.safe_uint DEFAULT 0,
  created_at timestamptz(3) DEFAULT clock_timestamp(),
  updated_at timestamptz(3) DEFAULT clock_timestamp(),
  legacy_meta lc_app.metadata NOT NULL DEFAULT
    '{"v":1,"absent":[],"null":[],"bsonTypes":{},"defaultProjection":[]}'
);

CREATE TABLE lc_app.chat_barriers (
  id lc_app.object_id CONSTRAINT chat_barriers_pk PRIMARY KEY,
  user_id lc_app.object_id NOT NULL REFERENCES lc_app.users(id) ON DELETE RESTRICT,
  target_language text COLLATE "C" NOT NULL,
  revision lc_app.safe_uint DEFAULT 0,
  document_version lc_app.safe_uint DEFAULT 0,
  legacy_meta lc_app.metadata NOT NULL DEFAULT
    '{"v":1,"absent":[],"null":[],"bsonTypes":{},"defaultProjection":[]}',
  CONSTRAINT chat_barriers_owner_language_uq UNIQUE (user_id,target_language)
);
