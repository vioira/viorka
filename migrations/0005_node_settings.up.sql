ALTER TABLE nodes ADD COLUMN settings_revision INTEGER NOT NULL DEFAULT 1 CHECK(settings_revision > 0);
ALTER TABLE nodes ADD COLUMN collection_seconds INTEGER NOT NULL DEFAULT 30 CHECK(collection_seconds BETWEEN 10 AND 300);
ALTER TABLE nodes ADD COLUMN report_seconds INTEGER NOT NULL DEFAULT 300 CHECK(report_seconds BETWEEN 60 AND 3600);
ALTER TABLE nodes ADD COLUMN connection_mode TEXT NOT NULL DEFAULT 'wss' CHECK(connection_mode='wss');
ALTER TABLE nodes ADD COLUMN wss_report_seconds INTEGER NOT NULL DEFAULT 30 CHECK(wss_report_seconds BETWEEN 10 AND 300 AND wss_report_seconds>=collection_seconds);
