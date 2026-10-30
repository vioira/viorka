CREATE TABLE system_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL CHECK(revision>=1),
  panel_name TEXT NOT NULL CHECK(length(panel_name) BETWEEN 1 AND 128),
  public_origin TEXT NOT NULL,
  theme TEXT NOT NULL CHECK(theme IN ('dark','light','system')),
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
