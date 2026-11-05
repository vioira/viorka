-- Latest effective configuration is durable even while a node is offline.
-- Execution records are created only by the online gateway reconciler.
CREATE TABLE engine_targets (
 engine_id TEXT PRIMARY KEY REFERENCES engines(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision > 0),
 command_encrypted TEXT NOT NULL,
 public_snapshot TEXT NOT NULL CHECK(json_valid(public_snapshot)),
 credential_encrypted TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id),
 sync_error TEXT NOT NULL DEFAULT ''
);
