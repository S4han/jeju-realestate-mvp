#!/usr/bin/env bash
# Copies app data from the local database to a remote one (e.g. Supabase) in a single transaction.
# Usage: SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... scripts/copy-to-remote.sh
# The target must already be migrated (npm run db:migrate with DATABASE_URL=target) and empty.
# Connection strings are read from the environment and never echoed.
set -euo pipefail
: "${SOURCE_DATABASE_URL:?set SOURCE_DATABASE_URL}" "${TARGET_DATABASE_URL:?set TARGET_DATABASE_URL}"
TABLES=(apartments apartment_source_ids apartment_aliases transactions match_reviews sync_jobs api_usage)
args=(); for t in "${TABLES[@]}"; do args+=(--table "public.$t"); done
existing=$(psql "$TARGET_DATABASE_URL" -tAc "SELECT count(*) FROM apartments" 2>/dev/null || echo "ERR")
if [[ "$existing" != "0" ]]; then echo "target is not an empty migrated database (apartments=$existing)"; exit 1; fi
pg_dump "$SOURCE_DATABASE_URL" --data-only --no-owner --no-privileges "${args[@]}" \
  | psql "$TARGET_DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -q >/dev/null
for t in "${TABLES[@]}"; do
  s=$(psql "$SOURCE_DATABASE_URL" -tAc "SELECT count(*) FROM $t"); d=$(psql "$TARGET_DATABASE_URL" -tAc "SELECT count(*) FROM $t")
  printf '%-22s source=%-6s target=%-6s %s\n' "$t" "$s" "$d" "$([[ $s == "$d" ]] && echo ok || echo MISMATCH)"
done
