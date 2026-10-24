-- 0004: hosted Postgres (Supabase) can expose the public schema through its Data API.
-- The app only reaches the database from server code as the table owner, so:
--  * enable RLS with no policies on every app table (owner bypasses RLS; Data API roles see nothing)
--  * revoke privileges from Supabase API roles when they exist (no-op on plain PostgreSQL)
DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['apartments','apartment_source_ids','apartment_aliases','transactions','match_reviews','sync_jobs','api_usage','schema_migrations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
    END IF;
  END LOOP;
END $$;
