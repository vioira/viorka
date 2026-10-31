-- Settings v2 has independent sampling/report clocks. Legacy settings described
-- asset refresh and cannot be reinterpreted; reset to the new defaults.
ALTER TABLE nodes DROP COLUMN wss_report_seconds;
ALTER TABLE nodes DROP COLUMN collection_seconds;
ALTER TABLE nodes DROP COLUMN report_seconds;
ALTER TABLE nodes ADD COLUMN collection_seconds INTEGER NOT NULL DEFAULT 0 CHECK(collection_seconds BETWEEN 0 AND 10);
ALTER TABLE nodes ADD COLUMN report_seconds INTEGER NOT NULL DEFAULT 60 CHECK(report_seconds BETWEEN 30 AND 180);
ALTER TABLE nodes ADD COLUMN wss_report_seconds INTEGER NOT NULL DEFAULT 2 CHECK(wss_report_seconds BETWEEN 1 AND 5);
UPDATE nodes SET settings_revision=settings_revision+1;
ALTER TABLE metric_rollups ADD COLUMN stats_json TEXT CHECK(stats_json IS NULL OR json_valid(stats_json));
ALTER TABLE metric_rollups ADD COLUMN last_sample_at TEXT;
CREATE INDEX idx_metric_rollups_expiry ON metric_rollups(bucket_start);
