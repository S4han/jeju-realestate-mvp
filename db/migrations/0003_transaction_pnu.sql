-- 0003: parcel id assembled from the detailed sale API (sggCd+umdCd+landCd+bonbun+bubun), used by matching (TASK-005).
ALTER TABLE transactions ADD COLUMN source_pnu CHAR(19) CHECK (source_pnu ~ '^[0-9]{19}$');
CREATE INDEX transactions_source_pnu_idx ON transactions (source_pnu);
