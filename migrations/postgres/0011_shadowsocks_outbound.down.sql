ALTER TABLE nodes DROP COLUMN ss_outbound_capable;
ALTER TABLE engine_targets DROP COLUMN requires_ss_outbound;
ALTER TABLE engine_operations DROP COLUMN requires_ss_outbound;
