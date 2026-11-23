CREATE TABLE alert_config (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>=1),
 config_json TEXT NOT NULL
);
INSERT INTO alert_config VALUES(1,1,'');
CREATE TABLE alert_channels (
 id TEXT PRIMARY KEY, secret_encrypted TEXT NOT NULL,
 last_state TEXT NOT NULL DEFAULT '', last_at TEXT NOT NULL DEFAULT '', last_detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE alert_states (
 rule_id TEXT NOT NULL,node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 started_ms INTEGER NOT NULL, last_sent_ms INTEGER NOT NULL, evaluated_ms INTEGER NOT NULL,
 period_ms INTEGER NOT NULL, PRIMARY KEY(rule_id,node_id)
);
CREATE TABLE alert_deliveries (
 id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES alert_channels(id) ON DELETE CASCADE,
 title TEXT NOT NULL, body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
 due_ms INTEGER NOT NULL, created_ms INTEGER NOT NULL, position INTEGER NOT NULL,
 UNIQUE(channel_id,position)
);
CREATE INDEX alert_deliveries_due ON alert_deliveries(due_ms,created_ms,id);
ALTER TABLE nodes ADD COLUMN outage_since TEXT;
UPDATE nodes SET outage_since=offline_alert_since WHERE offline_alert_since IS NOT NULL;
CREATE INDEX nodes_alert_outage ON nodes(outage_since,id) WHERE state='offline' AND outage_since IS NOT NULL;
ALTER TABLE notifications ADD COLUMN title TEXT NOT NULL DEFAULT '节点离线';
ALTER TABLE notifications ADD COLUMN event_kind TEXT NOT NULL DEFAULT 'trigger' CHECK(event_kind IN ('trigger','repeat','recovery'));
