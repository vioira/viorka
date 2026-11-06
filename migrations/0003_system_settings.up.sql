CREATE TABLE system_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL CHECK(revision>=1),
  panel_name TEXT NOT NULL CHECK(length(panel_name) BETWEEN 1 AND 128),
  public_origin TEXT NOT NULL,
  heartbeat_timeout_seconds INTEGER NOT NULL DEFAULT 300 CHECK(heartbeat_timeout_seconds BETWEEN 60 AND 3600),
  sse INTEGER NOT NULL CHECK(sse IN (0,1)),
  alerts INTEGER NOT NULL CHECK(alerts IN (0,1)),
  auto_backup INTEGER NOT NULL CHECK(auto_backup IN (0,1)),
  telemetry INTEGER NOT NULL CHECK(telemetry IN (0,1))
);
ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1));
CREATE TABLE user_invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','operator','viewer')),
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE backup_policy (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision INTEGER NOT NULL CHECK(revision>=1),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 cron TEXT NOT NULL CHECK(length(cron) BETWEEN 9 AND 128),
 retention_days INTEGER NOT NULL CHECK(retention_days BETWEEN 0 AND 36500),
 max_copies INTEGER NOT NULL CHECK(max_copies BETWEEN 0 AND 10000),
 s3_json TEXT NOT NULL CHECK(json_valid(s3_json)),
 secret_encrypted TEXT NOT NULL
);
INSERT INTO backup_policy VALUES(1,1,0,'0 3 * * *',14,0,'{}','');
