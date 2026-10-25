-- CRON-001 read-only check of past collection runs on the production DB (run with psql).
-- Measures how long real data.go.kr jobs took, so the daily Vercel Cron (60 s limit today) can be sized.
-- Aggregates only: no keys, URLs or row contents. Titles are English (Korean \echo breaks on Windows).
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';

\echo '1) per source: jobs, status counts, seconds per job and per call (all collector jobs)'
SELECT source_id,
       count(*) AS jobs,
       count(*) FILTER (WHERE status = 'SUCCESS') AS success,
       count(*) FILTER (WHERE status = 'PARTIAL') AS partial,
       count(*) FILTER (WHERE status = 'FAILED') AS failed,
       count(*) FILTER (WHERE status = 'RUNNING') AS running,
       sum(api_calls) AS calls,
       round(avg(extract(epoch FROM completed_at - started_at))::numeric, 2) AS avg_job_s,
       round(max(extract(epoch FROM completed_at - started_at))::numeric, 2) AS max_job_s,
       round((sum(extract(epoch FROM completed_at - started_at)) / nullif(sum(api_calls), 0))::numeric, 2) AS s_per_call,
       round(max(extract(epoch FROM completed_at - started_at) / nullif(api_calls, 0))::numeric, 2) AS max_s_per_call
  FROM sync_jobs
 WHERE source_id IN ('MOLIT_SALE', 'MOLIT_RENT') AND completed_at IS NOT NULL
 GROUP BY source_id ORDER BY source_id;

\echo '2) runs (jobs started within 10 minutes of each other): start, jobs, calls, wall-clock seconds'
WITH j AS (
  SELECT *, CASE WHEN started_at - lag(completed_at) OVER (ORDER BY started_at) > interval '10 minutes'
                 OR lag(completed_at) OVER (ORDER BY started_at) IS NULL THEN 1 ELSE 0 END AS new_run
    FROM sync_jobs WHERE source_id IN ('MOLIT_SALE', 'MOLIT_RENT')
), r AS (SELECT *, sum(new_run) OVER (ORDER BY started_at) AS run_no FROM j)
SELECT run_no, min(started_at) AS started, count(*) AS jobs, sum(api_calls) AS calls,
       string_agg(DISTINCT status, ',') AS statuses,
       round(extract(epoch FROM max(completed_at) - min(started_at))::numeric, 1) AS wall_s
  FROM r GROUP BY run_no ORDER BY run_no DESC LIMIT 15;

\echo '3) slowest 10 jobs'
SELECT source_id, city_code, period, status, api_calls, record_count,
       round(extract(epoch FROM completed_at - started_at)::numeric, 2) AS job_s, error_code
  FROM sync_jobs WHERE source_id IN ('MOLIT_SALE', 'MOLIT_RENT') AND completed_at IS NOT NULL
 ORDER BY completed_at - started_at DESC LIMIT 10;

\echo '4) failures by error code'
SELECT source_id, error_code, count(*) FROM sync_jobs
 WHERE status IN ('FAILED', 'PARTIAL') GROUP BY 1, 2 ORDER BY 1, 2;

\echo '5) jobs left RUNNING (never completed)'
SELECT source_id, city_code, period, started_at FROM sync_jobs WHERE status = 'RUNNING' ORDER BY started_at;

\echo '6) monthly rows per source and city for the last 4 months (pages needed: sale 1000/page, rent 400/page)'
SELECT DISTINCT ON (source_id, city_code, period) source_id, city_code, period, record_count, api_calls, status
  FROM sync_jobs
 WHERE source_id IN ('MOLIT_SALE', 'MOLIT_RENT') AND period >= to_char(now() AT TIME ZONE 'Asia/Seoul' - interval '3 months', 'YYYYMM')
 ORDER BY source_id, city_code, period, started_at DESC, job_id DESC;

\echo '7) api_usage, last 14 days'
SELECT usage_date, source_id, calls FROM api_usage WHERE usage_date >= current_date - 14 ORDER BY 1, 2;

\echo '8) table sizes for the matching step'
SELECT trade_type, count(*) AS rows FROM transactions GROUP BY 1 ORDER BY 1;
SELECT count(*) AS apartments FROM apartments;
SELECT max(completed_at) AS last_matching FROM sync_jobs WHERE source_id = 'MATCHING';

ROLLBACK;
