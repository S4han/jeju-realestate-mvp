-- 0005 (Phase 3, P3-TASK-003): reference data for region analysis — official legal codes and boundaries.
-- Decision P3-D1 (B): statistics are computed on request from Phase 1 tables; only reference data is stored here.
-- Nothing in Phase 1/2 tables changes. A region set is loaded, verified, then activated in one statement;
-- at most one set is ACTIVE, so readers never see a half-loaded set.

CREATE TABLE p3_region_sets (
  set_id              BIGSERIAL PRIMARY KEY,
  code_source         TEXT        NOT NULL,           -- e.g. 국토교통부_전국 법정동
  code_as_of          DATE        NOT NULL,
  code_checksum       TEXT        NOT NULL,           -- sha256 of the code file
  boundary_source     TEXT        NOT NULL,           -- e.g. 국토교통부 법정구역정보 LSMD_ADM_SECT_UMD
  boundary_as_of      DATE        NOT NULL,
  boundary_checksum   TEXT        NOT NULL,           -- sha256 of the .shp
  source_crs          TEXT        NOT NULL,           -- e.g. EPSG:5186 (stored geometry is WGS84 lon/lat)
  simplify_tolerance_m NUMERIC(6, 1) NOT NULL CHECK (simplify_tolerance_m >= 0),
  status              TEXT        NOT NULL DEFAULT 'LOADING'
                      CHECK (status IN ('LOADING', 'VERIFIED', 'ACTIVE', 'REJECTED', 'RETIRED')),
  verification        JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- checks and counts recorded by the loader
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at         TIMESTAMPTZ,
  activated_at        TIMESTAMPTZ,
  CHECK (status NOT IN ('VERIFIED', 'ACTIVE', 'RETIRED') OR verified_at IS NOT NULL),
  CHECK (status <> 'ACTIVE' OR activated_at IS NOT NULL)
);
CREATE UNIQUE INDEX p3_region_sets_one_active ON p3_region_sets ((true)) WHERE status = 'ACTIVE';

-- Display regions: the two cities and their legal eup/myeon/dong (ri codes roll up to their eup/myeon).
CREATE TABLE p3_regions (
  set_id       BIGINT   NOT NULL REFERENCES p3_region_sets (set_id) ON DELETE CASCADE,
  region_code  CHAR(10) NOT NULL CHECK (region_code ~ '^50(110|130)[0-9]{3}00$'),
  level        TEXT     NOT NULL CHECK (level IN ('CITY', 'UMD')),
  name         TEXT     NOT NULL,
  city_code    CHAR(5)  NOT NULL CHECK (city_code IN ('50110', '50130')),
  PRIMARY KEY (set_id, region_code),
  CHECK ((level = 'CITY') = (substr(region_code, 6, 3) = '000')),
  CHECK (left(region_code, 5) = city_code)
);

-- Display boundaries (simplified, WGS84 GeoJSON MultiPolygon coordinates) linked to their region.
CREATE TABLE p3_region_boundaries (
  set_id       BIGINT   NOT NULL,
  region_code  CHAR(10) NOT NULL,
  geometry     JSONB    NOT NULL CHECK (geometry ->> 'type' = 'MultiPolygon'),
  bbox         NUMERIC(10, 6)[] NOT NULL CHECK (cardinality(bbox) = 4),  -- [minLng, minLat, maxLng, maxLat]
  vertex_count INTEGER  NOT NULL CHECK (vertex_count > 0),
  area_m2      NUMERIC(14, 1) NOT NULL CHECK (area_m2 > 0),               -- of the source polygon
  PRIMARY KEY (set_id, region_code),
  FOREIGN KEY (set_id, region_code) REFERENCES p3_regions (set_id, region_code) ON DELETE CASCADE
);

-- Same protection as 0004 for the new tables (0004 lists its tables explicitly, so it does not cover these).
DO $$
DECLARE
  t text;
  r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['p3_region_sets', 'p3_regions', 'p3_region_boundaries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON p3_region_sets, p3_regions, p3_region_boundaries FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE p3_region_sets_set_id_seq FROM %I', r);
    END IF;
  END LOOP;
END $$;
