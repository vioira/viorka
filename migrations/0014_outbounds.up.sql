CREATE TABLE outbound_configs (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE,
 version INTEGER NOT NULL CHECK(version > 0),
 config_encrypted TEXT NOT NULL,
 created_at TEXT NOT NULL
);
ALTER TABLE engine_drafts ADD COLUMN routing_json TEXT NOT NULL DEFAULT 'null';
