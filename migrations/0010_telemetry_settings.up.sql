CREATE TABLE node_telemetry_settings (
 node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9223372036854775807),
 collection_seconds INTEGER NOT NULL CHECK(collection_seconds BETWEEN 1 AND 60),
 http_report_seconds INTEGER NOT NULL CHECK(http_report_seconds BETWEEN 30 AND 180),
 wss_report_seconds INTEGER NOT NULL CHECK(wss_report_seconds BETWEEN 1 AND 5),
 connection_mode TEXT NOT NULL CHECK(connection_mode='auto_http_wss'),
 log_level TEXT NOT NULL DEFAULT 'warn' CHECK(log_level IN ('debug','info','warn','error')),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json))
);
