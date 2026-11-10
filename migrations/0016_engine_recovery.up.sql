-- Deleted node metadata is kept only for recovery of a matching installed config.
CREATE TABLE engine_recovery_metadata (
 engine_id TEXT PRIMARY KEY,
 command_digest TEXT NOT NULL,
 snapshot_encrypted TEXT NOT NULL
);
