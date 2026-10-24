-- 0001_init: core schema for the Jeju apartment transaction MVP.
-- Design notes come from TASK-001 verification (docs/API_VERIFICATION.md):
--  * Source transactions have no unique id; identity = natural key + occurrence index.
--  * Cancelled deals stay in the source feed (cdealType = 'O'), so they are kept as rows.
--  * Apartments are linked to sources through PNU (REB) and aptSeq (MOLIT), never by name alone.

CREATE TABLE apartments (
  apartment_id      BIGSERIAL PRIMARY KEY,
  name              TEXT        NOT NULL,
  city_code         CHAR(5)     NOT NULL CHECK (city_code IN ('50110', '50130')),
  legal_dong_code   CHAR(10)    NOT NULL CHECK (legal_dong_code ~ '^[0-9]{10}$'),
  pnu               CHAR(19)    CHECK (pnu ~ '^[0-9]{19}$'),
  road_address      TEXT,
  lot_address       TEXT,
  unit_count        INTEGER     CHECK (unit_count >= 0),
  approved_on       DATE,
  latitude          NUMERIC(9, 7)  CHECK (latitude BETWEEN 33.0 AND 34.0),
  longitude         NUMERIC(10, 7) CHECK (longitude BETWEEN 126.0 AND 127.0),
  -- VERIFIED_PARCEL: parcel centroid passed checks; REVIEW: flagged, no marker; NONE: no coordinate.
  location_status   TEXT        NOT NULL DEFAULT 'NONE'
                    CHECK (location_status IN ('VERIFIED_PARCEL', 'REVIEW', 'NONE')),
  location_source   TEXT,
  source_updated_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((latitude IS NULL) = (longitude IS NULL)),
  CHECK (location_status = 'NONE' OR latitude IS NOT NULL)
);
CREATE INDEX apartments_city_idx ON apartments (city_code);
CREATE INDEX apartments_pnu_idx ON apartments (pnu);
CREATE INDEX apartments_lat_lng_idx ON apartments (latitude, longitude)
  WHERE location_status = 'VERIFIED_PARCEL';
CREATE INDEX apartments_name_idx ON apartments (lower(name) text_pattern_ops);

-- Official ids per source (REB complex_pk, MOLIT aptSeq, K-APT kaptCode).
CREATE TABLE apartment_source_ids (
  source       TEXT   NOT NULL CHECK (source IN ('REB', 'MOLIT_APTSEQ', 'KAPT')),
  source_id    TEXT   NOT NULL,
  apartment_id BIGINT NOT NULL REFERENCES apartments (apartment_id) ON DELETE CASCADE,
  verified_at  TIMESTAMPTZ,
  PRIMARY KEY (source, source_id)
);
CREATE INDEX apartment_source_ids_apartment_idx ON apartment_source_ids (apartment_id);

CREATE TABLE apartment_aliases (
  alias_id     BIGSERIAL PRIMARY KEY,
  apartment_id BIGINT NOT NULL REFERENCES apartments (apartment_id) ON DELETE CASCADE,
  alias_name   TEXT   NOT NULL,
  source       TEXT   NOT NULL,
  verified_at  TIMESTAMPTZ,
  UNIQUE (apartment_id, alias_name, source)
);
CREATE INDEX apartment_aliases_name_idx ON apartment_aliases (lower(alias_name) text_pattern_ops);

CREATE TABLE transactions (
  transaction_id    BIGSERIAL PRIMARY KEY,
  trade_type        TEXT     NOT NULL CHECK (trade_type IN ('sale', 'rent')),
  -- Identity within the source feed: natural key + occurrence (1-based) among identical rows.
  natural_key       TEXT     NOT NULL,
  occurrence        SMALLINT NOT NULL CHECK (occurrence >= 1),
  -- Raw location fields from the source, kept for matching and audit.
  source_apt_seq    TEXT,
  sgg_code          CHAR(5)  NOT NULL CHECK (sgg_code IN ('50110', '50130')),
  umd_code          CHAR(5),
  umd_name          TEXT     NOT NULL,
  jibun             TEXT,
  apt_name_raw      TEXT     NOT NULL,
  apt_dong          TEXT,
  -- Only CONFIRMED matches set this (see match_reviews).
  apartment_id      BIGINT   REFERENCES apartments (apartment_id),
  contract_date     DATE     NOT NULL,
  area_m2           NUMERIC(10, 4) NOT NULL CHECK (area_m2 > 0),
  floor             SMALLINT,
  -- Amounts in KRW (source is in 10,000 KRW units).
  sale_price        BIGINT   CHECK (sale_price > 0),
  deposit           BIGINT   CHECK (deposit >= 0),
  monthly_rent      BIGINT   CHECK (monthly_rent >= 0),
  contract_type     TEXT,
  contract_term     TEXT,
  cancelled_on      DATE,
  registered_on     DATE,
  record_status     TEXT     NOT NULL DEFAULT 'ACTIVE'
                    CHECK (record_status IN ('ACTIVE', 'CANCELLED', 'MISSING_FROM_SOURCE')),
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_updated_at TIMESTAMPTZ,
  UNIQUE (trade_type, natural_key, occurrence),
  CHECK (trade_type <> 'sale' OR (sale_price IS NOT NULL AND deposit IS NULL AND monthly_rent IS NULL)),
  CHECK (trade_type <> 'rent' OR (sale_price IS NULL AND deposit IS NOT NULL AND monthly_rent IS NOT NULL)),
  CHECK ((record_status = 'CANCELLED') = (cancelled_on IS NOT NULL) OR record_status = 'MISSING_FROM_SOURCE')
);
CREATE INDEX transactions_apartment_date_idx ON transactions (apartment_id, contract_date DESC)
  WHERE apartment_id IS NOT NULL;
CREATE INDEX transactions_apt_seq_idx ON transactions (source_apt_seq);
CREATE INDEX transactions_contract_month_idx ON transactions (sgg_code, trade_type, contract_date);

CREATE TABLE match_reviews (
  review_id              BIGSERIAL PRIMARY KEY,
  transaction_id         BIGINT NOT NULL REFERENCES transactions (transaction_id) ON DELETE CASCADE,
  candidate_apartment_id BIGINT REFERENCES apartments (apartment_id),
  match_rule             TEXT   NOT NULL,
  match_status           TEXT   NOT NULL CHECK (match_status IN ('CONFIRMED', 'PENDING', 'REJECTED')),
  reason                 TEXT,
  evidence               JSONB  NOT NULL DEFAULT '{}'::jsonb,
  reviewed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (match_status <> 'CONFIRMED' OR candidate_apartment_id IS NOT NULL)
);
CREATE INDEX match_reviews_transaction_idx ON match_reviews (transaction_id);
CREATE INDEX match_reviews_status_idx ON match_reviews (match_status);

CREATE TABLE sync_jobs (
  job_id        BIGSERIAL PRIMARY KEY,
  source_id     TEXT    NOT NULL,
  city_code     CHAR(5) CHECK (city_code IN ('50110', '50130')),
  period        CHAR(6) CHECK (period ~ '^[0-9]{6}$'),
  status        TEXT    NOT NULL CHECK (status IN ('RUNNING', 'SUCCESS', 'FAILED', 'PARTIAL')),
  record_count  INTEGER NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  api_calls     INTEGER NOT NULL DEFAULT 0 CHECK (api_calls >= 0),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  error_code    TEXT,
  -- Must never contain service keys or full request URLs.
  error_message TEXT
);
CREATE INDEX sync_jobs_source_period_idx ON sync_jobs (source_id, city_code, period, started_at DESC);

-- Daily external call budget per source (FR-020).
CREATE TABLE api_usage (
  usage_date DATE    NOT NULL,
  source_id  TEXT    NOT NULL,
  calls      INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  PRIMARY KEY (usage_date, source_id)
);
