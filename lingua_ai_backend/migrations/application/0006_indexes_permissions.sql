-- M2-R1 reviewed application schema. Explicit isolated migration only.
CREATE INDEX lessons_filter_idx ON lc_app.lessons(language_key,level,sort_order,id);
CREATE INDEX progresses_language_idx ON lc_app.progresses(user_id,language_key,lesson_id);
CREATE INDEX flashcards_due_idx ON lc_app.flashcards(user_id,next_review_date,id);
CREATE INDEX flashcards_alias_word_idx ON lc_app.flashcards(user_id,language_key,target_word,id);
CREATE INDEX community_feed_idx ON lc_app.community_posts(created_at DESC NULLS LAST,id DESC);
CREATE INDEX community_language_feed_idx ON lc_app.community_posts(language_key,created_at DESC NULLS LAST,id DESC);
CREATE INDEX community_image_idx ON lc_app.community_posts(image_url);
CREATE INDEX community_owner_idx ON lc_app.community_posts(user_id);
CREATE INDEX community_likes_owner_idx ON lc_app.community_likes(user_id,post_id);
CREATE INDEX chat_history_idx ON lc_app.chat_messages(user_id,language_key,created_at DESC NULLS LAST,id DESC);
CREATE INDEX control_events_target_idx ON lc_app.application_timeline_events(target_timeline_id,action);
CREATE INDEX progress_repairs_owner_idx ON lc_app.progress_audit_repairs(user_id,id);

CREATE FUNCTION lc_meta.reject_history_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='IMMUTABLE_APPLICATION_HISTORY'; END $$;
REVOKE ALL ON FUNCTION lc_meta.reject_history_mutation() FROM PUBLIC;
CREATE TRIGGER immutable_reset BEFORE UPDATE OR DELETE OR TRUNCATE ON lc_app.progress_resets
  FOR EACH STATEMENT EXECUTE FUNCTION lc_meta.reject_history_mutation();
CREATE TRIGGER immutable_card_operation BEFORE UPDATE OR DELETE OR TRUNCATE ON lc_app.flashcard_operations
  FOR EACH STATEMENT EXECUTE FUNCTION lc_meta.reject_history_mutation();
CREATE TRIGGER immutable_receipt BEFORE UPDATE OR DELETE OR TRUNCATE ON lc_app.mutation_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION lc_meta.reject_history_mutation();
CREATE TRIGGER immutable_event BEFORE UPDATE OR DELETE OR TRUNCATE ON lc_app.application_timeline_events
  FOR EACH STATEMENT EXECUTE FUNCTION lc_meta.reject_history_mutation();
CREATE TRIGGER immutable_repair BEFORE UPDATE OR DELETE OR TRUNCATE ON lc_app.progress_audit_repairs
  FOR EACH STATEMENT EXECUTE FUNCTION lc_meta.reject_history_mutation();
CREATE TRIGGER immutable_migration BEFORE UPDATE OR DELETE OR TRUNCATE ON lc_meta.schema_migrations
  FOR EACH STATEMENT EXECUTE FUNCTION lc_meta.reject_history_mutation();
CREATE TRIGGER immutable_cutover BEFORE UPDATE OR DELETE OR TRUNCATE ON lc_meta.cutover_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION lc_meta.reject_history_mutation();

REVOKE ALL ON ALL TABLES IN SCHEMA lc_app,lc_meta FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA lc_app,lc_meta FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE lc_app_owner IN SCHEMA lc_app,lc_meta
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA lc_app,lc_meta TO lc_app_runtime,lc_app_reference,lc_app_probe,lc_app_operator,lc_app_audit;

GRANT SELECT,INSERT,UPDATE ON lc_app.users TO lc_app_runtime;
GRANT SELECT ON lc_app.lessons TO lc_app_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON lc_app.progresses,lc_app.flashcards,
  lc_app.community_posts,lc_app.community_likes,lc_app.chat_messages,lc_app.chat_barriers TO lc_app_runtime;
GRANT SELECT,INSERT ON lc_app.progress_resets,lc_app.flashcard_operations,lc_app.mutation_receipts TO lc_app_runtime;
GRANT SELECT ON lc_app.application_timeline_control,lc_meta.database_identity,lc_meta.schema_migrations TO lc_app_runtime;
GRANT SELECT(id,image_url) ON lc_app.community_posts TO lc_app_reference;
GRANT SELECT ON lc_app.application_timeline_control,lc_meta.database_identity,lc_meta.schema_migrations TO lc_app_reference,lc_app_probe;
GRANT SELECT ON lc_app.application_timeline_control,lc_app.application_timeline_events,
  lc_meta.database_identity,lc_meta.schema_migrations,lc_meta.cutover_receipts TO lc_app_operator;
GRANT SELECT ON lc_app.users,lc_app.lessons,lc_app.progresses,lc_app.progress_resets,
  lc_app.flashcards,lc_app.flashcard_operations,lc_app.community_posts,lc_app.community_likes,
  lc_app.mutation_receipts,lc_app.chat_messages,lc_app.chat_barriers,
  lc_app.application_timeline_control,lc_app.application_timeline_events,lc_app.progress_audit_repairs,
  lc_meta.database_identity,lc_meta.schema_migrations,lc_meta.cutover_receipts TO lc_app_audit;
-- M4 functions/grants intentionally absent. No control row is seeded or opened.
