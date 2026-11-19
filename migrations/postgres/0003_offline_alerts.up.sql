ALTER TABLE system_settings ALTER COLUMN heartbeat_timeout_seconds SET DEFAULT 60;
UPDATE system_settings SET heartbeat_timeout_seconds=60 WHERE revision=1 AND heartbeat_timeout_seconds=300;
ALTER TABLE system_settings ADD COLUMN offline_alert_minutes INTEGER NOT NULL DEFAULT 5 CHECK(offline_alert_minutes IN (0,5,6,7,8,9,10,15,20,25,30,60));
UPDATE system_settings SET offline_alert_minutes=0 WHERE alerts=0;
ALTER TABLE system_settings DROP COLUMN alerts;
ALTER TABLE nodes ADD COLUMN offline_alert_since TEXT;
CREATE INDEX nodes_pending_offline_alert ON nodes(offline_alert_since,id) WHERE state='offline' AND offline_alert_since IS NOT NULL;
