ALTER TABLE notifications DROP COLUMN event_kind;
ALTER TABLE notifications DROP COLUMN title;
DROP INDEX nodes_alert_outage;
ALTER TABLE nodes DROP COLUMN outage_since;
DROP TABLE alert_deliveries;
DROP TABLE alert_states;
DROP TABLE alert_channels;
DROP TABLE alert_config;
