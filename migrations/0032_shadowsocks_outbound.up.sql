ALTER TABLE nodes ADD COLUMN ss_outbound_capable INTEGER NOT NULL DEFAULT 0 CHECK(ss_outbound_capable IN (0,1));
ALTER TABLE engine_targets ADD COLUMN requires_ss_outbound INTEGER NOT NULL DEFAULT 0 CHECK(requires_ss_outbound IN (0,1));
ALTER TABLE engine_operations ADD COLUMN requires_ss_outbound INTEGER NOT NULL DEFAULT 0 CHECK(requires_ss_outbound IN (0,1));
