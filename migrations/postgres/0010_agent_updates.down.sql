DROP INDEX idx_agent_update_active;
DROP TABLE agent_release_assets;
ALTER TABLE nodes DROP COLUMN agent_update_last_target;
ALTER TABLE nodes DROP COLUMN agent_auto_update;
ALTER TABLE nodes DROP COLUMN agent_update_capable;
ALTER TABLE nodes DROP COLUMN agent_management_connected;
