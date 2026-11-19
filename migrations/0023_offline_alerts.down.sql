DROP INDEX nodes_pending_offline_alert;
ALTER TABLE nodes DROP COLUMN offline_alert_since;
ALTER TABLE system_settings ADD COLUMN alerts INTEGER NOT NULL DEFAULT 1 CHECK(alerts IN (0,1));
UPDATE system_settings SET alerts=0 WHERE offline_alert_minutes=0;
ALTER TABLE system_settings DROP COLUMN offline_alert_minutes;
ALTER TABLE system_settings RENAME COLUMN heartbeat_timeout_seconds TO previous_timeout;
ALTER TABLE system_settings ADD COLUMN heartbeat_timeout_seconds INTEGER NOT NULL DEFAULT 300 CHECK(heartbeat_timeout_seconds BETWEEN 60 AND 3600);
UPDATE system_settings SET heartbeat_timeout_seconds=previous_timeout;
ALTER TABLE system_settings DROP COLUMN previous_timeout;
