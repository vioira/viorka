ALTER TABLE nodes ADD COLUMN agent_management_connected INTEGER NOT NULL DEFAULT 0 CHECK(agent_management_connected IN (0,1));
ALTER TABLE nodes ADD COLUMN agent_update_capable INTEGER NOT NULL DEFAULT 0 CHECK(agent_update_capable IN (0,1));
ALTER TABLE nodes ADD COLUMN agent_auto_update INTEGER NOT NULL DEFAULT 0 CHECK(agent_auto_update IN (0,1));
ALTER TABLE nodes ADD COLUMN agent_update_last_target TEXT NOT NULL DEFAULT '';
CREATE TABLE agent_release_assets(arch TEXT PRIMARY KEY, version TEXT NOT NULL, sha256 TEXT NOT NULL, checked_at TEXT NOT NULL);
CREATE UNIQUE INDEX idx_agent_update_active ON tasks(node_id) WHERE task_type='agent.update' AND state IN ('queued','dispatched','accepted','running');
