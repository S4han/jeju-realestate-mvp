-- 0002: provenance details for apartment coordinates (TASK-003).
ALTER TABLE apartments
  ADD COLUMN location_flags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN parcel_area_m2 NUMERIC(12, 1) CHECK (parcel_area_m2 > 0);

COMMENT ON COLUMN apartments.location_flags IS
  'Reasons for REVIEW (NON_RESIDENTIAL_JIMOK, SMALL_PARCEL, PARCEL_SMALL_FOR_UNITS) or info flags (REPRESENTATIVE_POINT, PARCEL_NOT_FOUND).';
COMMENT ON COLUMN apartments.location_source IS
  'Provenance, e.g. CADASTRAL:AL_D002_50_20261008:PARCEL_CENTROID';
