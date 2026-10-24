-- Read-only checks after restore. Prints counts and lock-down status only (no row data).
\pset footer off
SELECT 'apartments' AS tbl, count(*) AS n, 1153 AS expected FROM apartments
UNION ALL SELECT 'transactions', count(*), 7068 FROM transactions
UNION ALL SELECT 'match_reviews CONFIRMED', count(*), 6920 FROM match_reviews WHERE match_status = 'CONFIRMED'
UNION ALL SELECT 'match_reviews (all)', count(*), NULL FROM match_reviews
UNION ALL SELECT 'apartment_source_ids', count(*), NULL FROM apartment_source_ids
UNION ALL SELECT 'apartment_aliases', count(*), NULL FROM apartment_aliases
UNION ALL SELECT 'sync_jobs', count(*), NULL FROM sync_jobs
UNION ALL SELECT 'api_usage', count(*), NULL FROM api_usage
UNION ALL SELECT 'schema_migrations', count(*), 4 FROM schema_migrations;

SELECT c.relname AS tbl,
       c.relrowsecurity AS rls_on,
       CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
            THEN has_table_privilege('anon', c.oid, 'SELECT')::text ELSE 'no-anon-role' END AS anon_can_select,
       CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
            THEN has_table_privilege('authenticated', c.oid, 'SELECT')::text ELSE 'no-role' END AS authenticated_can_select
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relname;
