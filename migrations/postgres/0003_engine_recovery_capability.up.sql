ALTER TABLE nodes ADD COLUMN engine_recovery_capable INTEGER NOT NULL DEFAULT 0 CHECK(engine_recovery_capable IN (0,1));

CREATE TABLE managed_engine_recoveries (
 task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
 snapshot_encrypted TEXT NOT NULL,
 recovered_engine_id TEXT NOT NULL DEFAULT ''
);
