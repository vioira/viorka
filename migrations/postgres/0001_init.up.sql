-- 0001_init.up.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','operator','viewer')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
 engine_capable BIGINT NOT NULL DEFAULT 0 CHECK(engine_capable IN (0,1)),
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 128),
  kind TEXT NOT NULL CHECK(kind IN ('vps','nat')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','online','offline','disabled')),
  os TEXT,
  arch TEXT,
  agent_version TEXT,
  last_seen_at TEXT,
  enrollment_token_hash TEXT UNIQUE,
  enrollment_expires_at TEXT,
  enrollment_used_at TEXT,
  enrollment_revoked_at TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_credentials (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_credentials_node ON agent_credentials(node_id);

CREATE TABLE IF NOT EXISTS node_addresses (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('public_ipv4','public_ipv6','private_ipv4','private_ipv6','hostname')),
  address TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(node_id,kind,address)
);

CREATE TABLE IF NOT EXISTS port_allocations (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  public_host TEXT NOT NULL,
  public_port BIGINT NOT NULL CHECK(public_port BETWEEN 1 AND 65535),
  private_host TEXT NOT NULL,
  private_port BIGINT NOT NULL CHECK(private_port BETWEEN 1 AND 65535),
  transport TEXT NOT NULL CHECK(transport IN ('tcp','udp')),
  owner TEXT NOT NULL CHECK(owner IN ('provider','node','manual')),
  state TEXT NOT NULL DEFAULT 'assigned' CHECK(state IN ('assigned','active','inactive')),
  provider_name TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(node_id,public_host,public_port,transport)
);

CREATE TABLE IF NOT EXISTS engines (
 observed_at TEXT NOT NULL DEFAULT '',
 observed_revision BIGINT NOT NULL DEFAULT 0 CHECK(observed_revision>=0 AND observed_revision<=desired_revision),
 desired_revision BIGINT NOT NULL DEFAULT 0 CHECK(desired_revision>=0),
 run_intent TEXT NOT NULL DEFAULT 'running' CHECK(run_intent IN ('running','stopped')),
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(name IN ('sing-box','xray','realm')),
  version TEXT,
  binary_path TEXT,
  ownership TEXT NOT NULL DEFAULT 'observed' CHECK(ownership IN ('managed','observed')),
  status TEXT NOT NULL DEFAULT 'unknown',
  UNIQUE(node_id,name)
);

CREATE TABLE IF NOT EXISTS proxy_services (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  engine_id TEXT NOT NULL REFERENCES engines(id),
  name TEXT NOT NULL,
  protocol TEXT NOT NULL,
  listen_host TEXT NOT NULL,
  listen_port BIGINT NOT NULL CHECK(listen_port BETWEEN 1 AND 65535),
  transport TEXT NOT NULL CHECK(transport IN ('tcp','udp','both')),
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled BIGINT NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proxy_services_node ON proxy_services(node_id);

CREATE TABLE IF NOT EXISTS relay_rules (
  id TEXT PRIMARY KEY,
  source_node_id TEXT NOT NULL REFERENCES nodes(id),
  destination_node_id TEXT REFERENCES nodes(id),
  engine_id TEXT NOT NULL REFERENCES engines(id),
  listen_host TEXT NOT NULL,
  listen_port BIGINT NOT NULL CHECK(listen_port BETWEEN 1 AND 65535),
  target_host TEXT NOT NULL,
  target_port BIGINT NOT NULL CHECK(target_port BETWEEN 1 AND 65535),
  transport TEXT NOT NULL CHECK(transport IN ('tcp','udp')),
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled BIGINT NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
);

CREATE TABLE IF NOT EXISTS config_revisions (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK(revision > 0),
  sha256 TEXT NOT NULL,
  desired_json TEXT NOT NULL,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(node_id,resource_kind,resource_id,revision)
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  desired_revision BIGINT NOT NULL,
  observed_revision BIGINT,
  status TEXT NOT NULL CHECK(status IN ('pending','applying','healthy','degraded','failed','rolled_back')),
  error_message TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(node_id,resource_kind,resource_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  revision BIGINT,
  state TEXT NOT NULL CHECK(state IN ('queued','dispatched','accepted','running','succeeded','failed','rolled_back','cancelled')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  attempt BIGINT NOT NULL DEFAULT 0 CHECK(attempt >= 0),
  max_attempts BIGINT NOT NULL DEFAULT 3 CHECK(max_attempts >= 1),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(node_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_tasks_node_state ON tasks(node_id,state,created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  source_ip TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
-- Keep runtime intent, submitted state and observed state distinct.
CREATE TABLE IF NOT EXISTS engine_drafts (
 engine_id TEXT PRIMARY KEY REFERENCES engines(id) ON DELETE CASCADE,
 version BIGINT NOT NULL DEFAULT 0 CHECK(version>=0),
 services_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(services_json)),
 updated_by TEXT REFERENCES users(id),
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS engine_node_grants (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 can_manage BIGINT NOT NULL DEFAULT 0 CHECK(can_manage IN (0,1)),
 can_export BIGINT NOT NULL DEFAULT 0 CHECK(can_export IN (0,1)),
 PRIMARY KEY(user_id,node_id)
);
-- Reservations intentionally also cover disabled and pending-delete services.
CREATE TABLE IF NOT EXISTS engine_port_reservations (
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 engine_id TEXT NOT NULL REFERENCES engines(id) ON DELETE CASCADE,
 service_id TEXT NOT NULL,
 listen_host TEXT NOT NULL,
 listen_port BIGINT NOT NULL CHECK(listen_port BETWEEN 1 AND 65535),
 PRIMARY KEY(engine_id,service_id,listen_host,listen_port),
 UNIQUE(node_id,listen_host,listen_port)
);
INSERT INTO engine_drafts(engine_id,updated_at) SELECT id,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"000Z"') FROM engines ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS engine_operations (
 task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
 engine_id TEXT NOT NULL REFERENCES engines(id),
 draft_version BIGINT NOT NULL,
 command_encrypted TEXT NOT NULL,
 request_json TEXT NOT NULL,
 public_snapshot TEXT NOT NULL CHECK(json_valid(public_snapshot)),
 credential_encrypted TEXT NOT NULL,
 operation TEXT NOT NULL,
 revision BIGINT NOT NULL,
 active BIGINT NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS engine_operation_mutex ON engine_operations(engine_id) WHERE active=1;
CREATE TABLE IF NOT EXISTS engine_credentials (
 engine_id TEXT PRIMARY KEY REFERENCES engines(id) ON DELETE CASCADE,
 encrypted TEXT NOT NULL
);

-- 0002_auth_and_task_leases.up.sql
CREATE UNIQUE INDEX idx_agent_public_key ON agent_credentials(public_key);
CREATE TABLE web_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE agent_challenges (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE agent_sessions (
  token_hash TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
ALTER TABLE tasks ADD COLUMN deadline_at TEXT;
ALTER TABLE tasks ADD COLUMN lease_until TEXT;
CREATE INDEX idx_web_sessions_expiry ON web_sessions(expires_at);
CREATE INDEX idx_agent_sessions_expiry ON agent_sessions(expires_at);
CREATE INDEX idx_agent_challenges_expiry ON agent_challenges(expires_at);

-- 0003_system_settings.up.sql
CREATE TABLE system_settings (
  id BIGINT PRIMARY KEY CHECK(id=1),
  revision BIGINT NOT NULL CHECK(revision>=1),
  panel_name TEXT NOT NULL CHECK(length(panel_name) BETWEEN 1 AND 128),
  public_origin TEXT NOT NULL,
  heartbeat_timeout_seconds BIGINT NOT NULL DEFAULT 300 CHECK(heartbeat_timeout_seconds BETWEEN 60 AND 3600),
  sse BIGINT NOT NULL CHECK(sse IN (0,1)),
  alerts BIGINT NOT NULL CHECK(alerts IN (0,1)),
  auto_backup BIGINT NOT NULL CHECK(auto_backup IN (0,1)),
  telemetry BIGINT NOT NULL CHECK(telemetry IN (0,1))
);
ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN disabled BIGINT NOT NULL DEFAULT 0 CHECK(disabled IN (0,1));
CREATE TABLE user_invitations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','operator','viewer')),
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  message TEXT NOT NULL
);

CREATE TABLE backup_policy (
 id BIGINT PRIMARY KEY CHECK(id=1),
 revision BIGINT NOT NULL CHECK(revision>=1),
 enabled BIGINT NOT NULL CHECK(enabled IN (0,1)),
 cron TEXT NOT NULL CHECK(length(cron) BETWEEN 9 AND 128),
 retention_days BIGINT NOT NULL CHECK(retention_days BETWEEN 0 AND 36500),
 max_copies BIGINT NOT NULL CHECK(max_copies BETWEEN 0 AND 10000),
 s3_json TEXT NOT NULL CHECK(json_valid(s3_json)),
 secret_encrypted TEXT NOT NULL
);
INSERT INTO backup_policy VALUES(1,1,0,'0 3 * * *',14,0,'{}','');

-- 0004_node_inventory.up.sql
ALTER TABLE nodes ADD COLUMN inventory_json TEXT CHECK (inventory_json IS NULL OR json_valid(inventory_json));

-- 0007_notification_reads.up.sql
CREATE TABLE notification_reads (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 notification_id TEXT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
 PRIMARY KEY (user_id, notification_id)
);
CREATE INDEX notification_reads_notification ON notification_reads(notification_id);

-- 0009_telemetry_history.up.sql
-- Development schema: fixed 30-second bucket values.
CREATE TABLE metrics_history (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  bucket_start BIGINT NOT NULL CHECK(bucket_start>=0 AND bucket_start%30=0),
  last_sample_at BIGINT NOT NULL CHECK(last_sample_at>=bucket_start*1000 AND last_sample_at<(bucket_start+30)*1000),
  cpu_avg DOUBLE PRECISION CHECK(cpu_avg>=0),
  ram_used_avg DOUBLE PRECISION CHECK(ram_used_avg>=0),
  swap_used_avg DOUBLE PRECISION CHECK(swap_used_avg>=0),
  net_in_speed_max DOUBLE PRECISION CHECK(net_in_speed_max>=0),
  net_out_speed_max DOUBLE PRECISION CHECK(net_out_speed_max>=0),
  tcp_count_max BIGINT CHECK(tcp_count_max BETWEEN 0 AND 1048576),
  udp_count_max BIGINT CHECK(udp_count_max BETWEEN 0 AND 1048576),
  process_count_max BIGINT CHECK(process_count_max BETWEEN 0 AND 1048576),
  disk_read_speed_max DOUBLE PRECISION CHECK(disk_read_speed_max>=0),
  disk_write_speed_max DOUBLE PRECISION CHECK(disk_write_speed_max>=0),
  disk_read_iops_max DOUBLE PRECISION CHECK(disk_read_iops_max>=0),
  disk_write_iops_max DOUBLE PRECISION CHECK(disk_write_iops_max>=0),
  disk_await_ms_max DOUBLE PRECISION CHECK(disk_await_ms_max>=0),
  disk_util_percent_max DOUBLE PRECISION CHECK(disk_util_percent_max>=0 AND disk_util_percent_max<=100),
  ram_total BIGINT CHECK(ram_total>=0),
  swap_total BIGINT CHECK(swap_total>=0),
  net_in_total BIGINT CHECK(net_in_total>=0),
  net_out_total BIGINT CHECK(net_out_total>=0),
  net_month_in BIGINT CHECK(net_month_in>=0),
  net_month_out BIGINT CHECK(net_month_out>=0),
  traffic_period_start BIGINT CHECK(traffic_period_start>=0),
  disk_total BIGINT CHECK(disk_total>=0),
  disk_used BIGINT CHECK(disk_used>=0),
  disk_available BIGINT CHECK(disk_available>=0),
  load_1 DOUBLE PRECISION CHECK(load_1>=0),
  load_5 DOUBLE PRECISION CHECK(load_5>=0),
  load_15 DOUBLE PRECISION CHECK(load_15>=0),
  uptime_seconds DOUBLE PRECISION CHECK(uptime_seconds>=0),
  updated_at BIGINT NOT NULL CHECK(updated_at>=0),
  PRIMARY KEY(node_id,bucket_start)
);
CREATE INDEX idx_metrics_history_time ON metrics_history(bucket_start);
CREATE TABLE metrics_history_old (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  bucket_start BIGINT NOT NULL CHECK(bucket_start>=0 AND bucket_start%30=0),
  last_sample_at BIGINT NOT NULL CHECK(last_sample_at>=bucket_start*1000 AND last_sample_at<(bucket_start+30)*1000),
  cpu_avg DOUBLE PRECISION CHECK(cpu_avg>=0),
  ram_used_avg DOUBLE PRECISION CHECK(ram_used_avg>=0),
  swap_used_avg DOUBLE PRECISION CHECK(swap_used_avg>=0),
  net_in_speed_max DOUBLE PRECISION CHECK(net_in_speed_max>=0),
  net_out_speed_max DOUBLE PRECISION CHECK(net_out_speed_max>=0),
  tcp_count_max BIGINT CHECK(tcp_count_max BETWEEN 0 AND 1048576),
  udp_count_max BIGINT CHECK(udp_count_max BETWEEN 0 AND 1048576),
  process_count_max BIGINT CHECK(process_count_max BETWEEN 0 AND 1048576),
  disk_read_speed_max DOUBLE PRECISION CHECK(disk_read_speed_max>=0),
  disk_write_speed_max DOUBLE PRECISION CHECK(disk_write_speed_max>=0),
  disk_read_iops_max DOUBLE PRECISION CHECK(disk_read_iops_max>=0),
  disk_write_iops_max DOUBLE PRECISION CHECK(disk_write_iops_max>=0),
  disk_await_ms_max DOUBLE PRECISION CHECK(disk_await_ms_max>=0),
  disk_util_percent_max DOUBLE PRECISION CHECK(disk_util_percent_max>=0 AND disk_util_percent_max<=100),
  ram_total BIGINT CHECK(ram_total>=0),
  swap_total BIGINT CHECK(swap_total>=0),
  net_in_total BIGINT CHECK(net_in_total>=0),
  net_out_total BIGINT CHECK(net_out_total>=0),
  net_month_in BIGINT CHECK(net_month_in>=0),
  net_month_out BIGINT CHECK(net_month_out>=0),
  traffic_period_start BIGINT CHECK(traffic_period_start>=0),
  disk_total BIGINT CHECK(disk_total>=0),
  disk_used BIGINT CHECK(disk_used>=0),
  disk_available BIGINT CHECK(disk_available>=0),
  load_1 DOUBLE PRECISION CHECK(load_1>=0),
  load_5 DOUBLE PRECISION CHECK(load_5>=0),
  load_15 DOUBLE PRECISION CHECK(load_15>=0),
  uptime_seconds DOUBLE PRECISION CHECK(uptime_seconds>=0),
  updated_at BIGINT NOT NULL CHECK(updated_at>=0),
  PRIMARY KEY(node_id,bucket_start)
);
CREATE INDEX idx_metrics_history_old_time ON metrics_history_old(bucket_start);
CREATE TABLE metric_history_partitions (
 role TEXT PRIMARY KEY CHECK(role IN ('current','previous')),
 week_start BIGINT NOT NULL CHECK(week_start>=0 AND (week_start+345600)%604800=0),
 schema_version BIGINT NOT NULL CHECK(schema_version=1)
);
CREATE TABLE metric_ingest_checkpoints (
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL CHECK(length(run_id) BETWEEN 1 AND 128),
 metric_group TEXT NOT NULL CHECK(metric_group IN ('fast','full','public_ip','legacy')),
 committed_sequence BIGINT NOT NULL CHECK(committed_sequence>0),
 sampled_at BIGINT NOT NULL CHECK(sampled_at>=0),
 PRIMARY KEY(node_id,run_id,metric_group)
);
CREATE TABLE node_system_info (
 node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
 os_id TEXT NOT NULL CHECK(length(os_id)<=128),
 os_name TEXT NOT NULL CHECK(length(os_name)<=256),
 os_version TEXT NOT NULL CHECK(length(os_version)<=256),
 sampled_at BIGINT NOT NULL CHECK(sampled_at>=0),
 unavailable BIGINT NOT NULL CHECK(unavailable IN (0,1))
);
CREATE TABLE node_public_addresses (
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 family BIGINT NOT NULL CHECK(family IN (4,6)),
 address TEXT NOT NULL CHECK(length(address)<=45),
 sampled_at BIGINT NOT NULL CHECK(sampled_at>=0),
 unavailable BIGINT NOT NULL CHECK(unavailable IN (0,1)),
 CHECK((unavailable=1 AND address='') OR (unavailable=0 AND address!='')),
 PRIMARY KEY(node_id,family)
);

-- 0010_telemetry_settings.up.sql
CREATE TABLE node_telemetry_settings (
 traffic_json TEXT CHECK(traffic_json IS NULL OR json_valid(traffic_json)),
 node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
 revision BIGINT NOT NULL CHECK(revision BETWEEN 1 AND 9223372036854775807),
 collection_seconds BIGINT NOT NULL CHECK(collection_seconds BETWEEN 1 AND 60),
 http_report_seconds BIGINT NOT NULL CHECK(http_report_seconds BETWEEN 30 AND 180),
 wss_report_seconds BIGINT NOT NULL CHECK(wss_report_seconds BETWEEN 1 AND 5),
 connection_mode TEXT NOT NULL CHECK(connection_mode='auto_http_wss'),
 log_level TEXT NOT NULL DEFAULT 'warn' CHECK(log_level IN ('debug','info','warn','error')),
 result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json))
);

-- 0011_protocol_presets.up.sql
CREATE TABLE protocol_presets (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 128),
 protocol TEXT NOT NULL CHECK(protocol = 'vless'),
 config_json TEXT NOT NULL CHECK(json_valid(config_json)),
 created_at TEXT NOT NULL
);

-- 0012_engine_targets.up.sql
-- Latest effective configuration is durable even while a node is offline.
-- Execution records are created only by the online gateway reconciler.
CREATE TABLE engine_targets (
 engine_id TEXT PRIMARY KEY REFERENCES engines(id) ON DELETE CASCADE,
 revision BIGINT NOT NULL CHECK(revision > 0),
 command_encrypted TEXT NOT NULL,
 public_snapshot TEXT NOT NULL CHECK(json_valid(public_snapshot)),
 credential_encrypted TEXT NOT NULL,
 updated_by TEXT NOT NULL REFERENCES users(id),
 sync_error TEXT NOT NULL DEFAULT ''
);

-- 0013_node_location.up.sql
ALTER TABLE nodes ADD COLUMN geo_country_code TEXT NOT NULL DEFAULT '' CHECK(geo_country_code='' OR (length(geo_country_code)=2 AND geo_country_code ~ '^[A-Z]{2}$'));
ALTER TABLE nodes ADD COLUMN geo_subdivision TEXT NOT NULL DEFAULT '' CHECK(length(geo_subdivision)<=256);
ALTER TABLE nodes ADD COLUMN geo_city TEXT NOT NULL DEFAULT '' CHECK(length(geo_city)<=256);

-- 0014_outbounds.up.sql
CREATE TABLE outbound_configs (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE,
 version BIGINT NOT NULL CHECK(version > 0),
 config_encrypted TEXT NOT NULL,
 created_at TEXT NOT NULL
);
ALTER TABLE engine_drafts ADD COLUMN routing_json TEXT NOT NULL DEFAULT 'null';

-- 0015_login_security.up.sql
CREATE TABLE login_history (
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id),
 method TEXT NOT NULL, source TEXT NOT NULL, user_agent TEXT NOT NULL,
 first_ip TEXT NOT NULL, latest_ip TEXT NOT NULL, created_at TEXT NOT NULL,
 last_active_at TEXT NOT NULL, expires_at TEXT NOT NULL, ended_at TEXT NOT NULL DEFAULT '', end_reason TEXT NOT NULL DEFAULT ''
);
CREATE INDEX login_history_user ON login_history(user_id,created_at DESC,id DESC);
CREATE TABLE login_ips (
 session_id TEXT NOT NULL REFERENCES login_history(id) ON DELETE CASCADE,
 ip TEXT NOT NULL, first_used_at TEXT NOT NULL, last_used_at TEXT NOT NULL,
 PRIMARY KEY(session_id,ip)
);
CREATE FUNCTION end_web_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ended text := to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"000Z"');
BEGIN
 UPDATE login_history SET ended_at=CASE WHEN expires_at<=ended THEN expires_at ELSE ended END,
 end_reason=CASE WHEN expires_at<=ended THEN 'expired' ELSE 'revoked' END WHERE token_hash=OLD.token_hash AND ended_at='';
 RETURN OLD;
END;
$$;
CREATE TRIGGER web_session_ended AFTER DELETE ON web_sessions FOR EACH ROW EXECUTE FUNCTION end_web_session();
CREATE TABLE passkeys (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 credential TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX passkeys_user ON passkeys(user_id);
CREATE TABLE webauthn_challenges (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
 binding TEXT NOT NULL, data TEXT NOT NULL, expires_at TEXT NOT NULL
);

-- 0016_engine_recovery.up.sql
-- Deleted node metadata is kept only for recovery of a matching installed config.
CREATE TABLE engine_recovery_metadata (
 engine_id TEXT PRIMARY KEY,
 command_digest TEXT NOT NULL,
 snapshot_encrypted TEXT NOT NULL
);

-- 0017_tcp_probe_settings.up.sql
ALTER TABLE system_settings ADD COLUMN tcp_probe_targets TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tcp_probe_targets) AND json_type(tcp_probe_targets)='array' AND json_array_length(tcp_probe_targets)<=3);
ALTER TABLE node_telemetry_settings ADD COLUMN tcp_probe_json TEXT CHECK(tcp_probe_json IS NULL OR json_valid(tcp_probe_json));
ALTER TABLE system_settings ADD COLUMN tcp_probe_names TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tcp_probe_names) AND json_type(tcp_probe_names)='array' AND json_array_length(tcp_probe_names)<=3);

-- 0018_tcp_probe_history.up.sql
CREATE TABLE tcp_probe_history (
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 bucket_start BIGINT NOT NULL CHECK(bucket_start>=0 AND bucket_start%60=0),
 sampled_at BIGINT NOT NULL CHECK(sampled_at>=bucket_start*1000 AND sampled_at<(bucket_start+60)*1000),
 target_1 TEXT CHECK(target_1 IS NULL OR length(target_1) BETWEEN 3 AND 259),
 ping_1 DOUBLE PRECISION CHECK(ping_1 IS NULL OR ping_1=-1 OR ping_1>=0),
 loss_1 BIGINT CHECK(loss_1 IS NULL OR (loss_1 BETWEEN 0 AND 100)),
 target_2 TEXT CHECK(target_2 IS NULL OR length(target_2) BETWEEN 3 AND 259),
 ping_2 DOUBLE PRECISION CHECK(ping_2 IS NULL OR ping_2=-1 OR ping_2>=0),
 loss_2 BIGINT CHECK(loss_2 IS NULL OR (loss_2 BETWEEN 0 AND 100)),
 target_3 TEXT CHECK(target_3 IS NULL OR length(target_3) BETWEEN 3 AND 259),
 ping_3 DOUBLE PRECISION CHECK(ping_3 IS NULL OR ping_3=-1 OR ping_3>=0),
 loss_3 BIGINT CHECK(loss_3 IS NULL OR (loss_3 BETWEEN 0 AND 100)),
 CHECK((target_1 IS NULL AND ping_1 IS NULL AND loss_1 IS NULL) OR
       (target_1 IS NOT NULL AND ping_1 IS NOT NULL AND loss_1 IS NOT NULL AND ((ping_1=-1 AND loss_1=100) OR (ping_1>=0 AND loss_1<100)))),
 CHECK((target_2 IS NULL AND ping_2 IS NULL AND loss_2 IS NULL) OR
       (target_2 IS NOT NULL AND ping_2 IS NOT NULL AND loss_2 IS NOT NULL AND ((ping_2=-1 AND loss_2=100) OR (ping_2>=0 AND loss_2<100)))),
 CHECK((target_3 IS NULL AND ping_3 IS NULL AND loss_3 IS NULL) OR
       (target_3 IS NOT NULL AND ping_3 IS NOT NULL AND loss_3 IS NOT NULL AND ((ping_3=-1 AND loss_3=100) OR (ping_3>=0 AND loss_3<100)))),
 CHECK(target_1 IS NOT NULL),
 CHECK(target_3 IS NULL OR target_2 IS NOT NULL),
 CHECK(target_1<>target_2 AND target_1<>target_3 AND target_2<>target_3),
 PRIMARY KEY(node_id,bucket_start)
);

CREATE TABLE tcp_probe_history_old (
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 bucket_start BIGINT NOT NULL CHECK(bucket_start>=0 AND bucket_start%60=0),
 sampled_at BIGINT NOT NULL CHECK(sampled_at>=bucket_start*1000 AND sampled_at<(bucket_start+60)*1000),
 target_1 TEXT CHECK(target_1 IS NULL OR length(target_1) BETWEEN 3 AND 259),
 ping_1 DOUBLE PRECISION CHECK(ping_1 IS NULL OR ping_1=-1 OR ping_1>=0),
 loss_1 BIGINT CHECK(loss_1 IS NULL OR (loss_1 BETWEEN 0 AND 100)),
 target_2 TEXT CHECK(target_2 IS NULL OR length(target_2) BETWEEN 3 AND 259),
 ping_2 DOUBLE PRECISION CHECK(ping_2 IS NULL OR ping_2=-1 OR ping_2>=0),
 loss_2 BIGINT CHECK(loss_2 IS NULL OR (loss_2 BETWEEN 0 AND 100)),
 target_3 TEXT CHECK(target_3 IS NULL OR length(target_3) BETWEEN 3 AND 259),
 ping_3 DOUBLE PRECISION CHECK(ping_3 IS NULL OR ping_3=-1 OR ping_3>=0),
 loss_3 BIGINT CHECK(loss_3 IS NULL OR (loss_3 BETWEEN 0 AND 100)),
 CHECK((target_1 IS NULL AND ping_1 IS NULL AND loss_1 IS NULL) OR
       (target_1 IS NOT NULL AND ping_1 IS NOT NULL AND loss_1 IS NOT NULL AND ((ping_1=-1 AND loss_1=100) OR (ping_1>=0 AND loss_1<100)))),
 CHECK((target_2 IS NULL AND ping_2 IS NULL AND loss_2 IS NULL) OR
       (target_2 IS NOT NULL AND ping_2 IS NOT NULL AND loss_2 IS NOT NULL AND ((ping_2=-1 AND loss_2=100) OR (ping_2>=0 AND loss_2<100)))),
 CHECK((target_3 IS NULL AND ping_3 IS NULL AND loss_3 IS NULL) OR
       (target_3 IS NOT NULL AND ping_3 IS NOT NULL AND loss_3 IS NOT NULL AND ((ping_3=-1 AND loss_3=100) OR (ping_3>=0 AND loss_3<100)))),
 CHECK(target_1 IS NOT NULL),
 CHECK(target_3 IS NULL OR target_2 IS NOT NULL),
 CHECK(target_1<>target_2 AND target_1<>target_3 AND target_2<>target_3),
 PRIMARY KEY(node_id,bucket_start)
);

-- 0019_node_daily_traffic.up.sql
CREATE TABLE node_daily_traffic (
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 day_start BIGINT NOT NULL CHECK(day_start>=0),
 day_end BIGINT NOT NULL CHECK(day_end>day_start AND day_end-day_start<=93600000),
 rx_bytes BIGINT NOT NULL CHECK(rx_bytes>=0),
 tx_bytes BIGINT NOT NULL CHECK(tx_bytes>=0),
 sampled_at BIGINT NOT NULL CHECK(sampled_at>=day_start AND sampled_at<=day_end),
 revision BIGINT NOT NULL CHECK(revision>0),
 quality BIGINT NOT NULL CHECK(quality BETWEEN 0 AND 15),
 PRIMARY KEY(node_id,day_start)
);

-- 0020_node_registration.up.sql
CREATE TABLE node_registration_tokens (
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 128),
 kind TEXT NOT NULL CHECK(kind IN ('vps','nat')),
 name_prefix TEXT NOT NULL CHECK(length(name_prefix)<=32),
 max_uses BIGINT NOT NULL CHECK(max_uses BETWEEN 1 AND 10000),
 used_count BIGINT NOT NULL DEFAULT 0 CHECK(used_count>=0 AND used_count<=max_uses),
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked_at TEXT
);
-- Retain identity tombstones after node deletion: deleting nodes never returns quota
-- or permits an old registration request to recreate a deleted identity.
CREATE TABLE node_registrations (
 id TEXT PRIMARY KEY,
 token_id TEXT NOT NULL REFERENCES node_registration_tokens(id),
 public_key TEXT NOT NULL UNIQUE,
 node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL,
 UNIQUE(token_id,public_key)
);
CREATE INDEX idx_node_registrations_token ON node_registrations(token_id,id);

-- 0021_subscriptions.up.sql
CREATE TABLE subscription_rules (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 128),
 format TEXT NOT NULL CHECK(format IN ('mihomo','sing-box','loon')),
 conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json) AND json_type(conditions_json)='array' AND json_array_length(conditions_json)<=32),
 position BIGINT NOT NULL CHECK(position BETWEEN 0 AND 10000),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 enabled BIGINT NOT NULL CHECK(enabled IN (0,1))
);
-- These are application request identifiers documented by their upstreams.
-- Loon's native remote-profile User-Agent has not yet been verified; an
-- administrator must add the appropriate condition before enabling it.
INSERT INTO subscription_rules(id,name,format,conditions_json,position,enabled) VALUES
 ('mihomo','mihomo','mihomo','[{"kind":"contains","pattern":"clash.meta"},{"kind":"contains","pattern":"clash-verge"}]',100,1),
 ('sing-box','sing-box','sing-box','[{"kind":"contains","pattern":"sing-box"}]',200,1),
 ('loon','loon','loon','[]',300,0);

CREATE TABLE subscriptions (
 id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL REFERENCES users(id),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 128),
 token_hash TEXT UNIQUE,
 mihomo_port BIGINT NOT NULL CHECK(mihomo_port BETWEEN 1 AND 65535),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(owner_id,name)
);
CREATE INDEX subscriptions_owner_id ON subscriptions(owner_id,id);

CREATE TABLE subscription_rule_links (
 subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
 rule_id TEXT NOT NULL REFERENCES subscription_rules(id) ON DELETE RESTRICT,
 PRIMARY KEY(subscription_id,rule_id)
);
CREATE INDEX subscription_rule_links_rule ON subscription_rule_links(rule_id,subscription_id);

-- Keep resource identities after deletion so a new service cannot silently
-- inherit a subscription entry. Engine/service IDs are scoped to the node.
CREATE TABLE subscription_service_links (
 subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
 node_id TEXT NOT NULL,
 engine_id TEXT NOT NULL,
 service_id TEXT NOT NULL,
 position BIGINT NOT NULL CHECK(position>=0),
 invalidated BIGINT NOT NULL DEFAULT 0 CHECK(invalidated IN (0,1)),
 PRIMARY KEY(subscription_id,node_id,engine_id,service_id),
 UNIQUE(subscription_id,position)
);
CREATE INDEX subscription_service_links_engine ON subscription_service_links(node_id,engine_id,service_id);

CREATE TABLE subscription_accesses (
 id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
 at TEXT NOT NULL,
 user_agent TEXT NOT NULL CHECK(length(user_agent)<=1024),
 rule_id TEXT NOT NULL,
 format TEXT NOT NULL,
 result TEXT NOT NULL CHECK(result IN ('ok','unrecognized','no_services','forbidden','unavailable'))
);
CREATE INDEX subscription_accesses_recent ON subscription_accesses(subscription_id,id DESC);

-- Present only after a database restore. Existing engines are withheld from
-- subscriptions until a fresh authenticated Agent observation is confirmed.
CREATE TABLE subscription_restore_engines (
 engine_id TEXT PRIMARY KEY REFERENCES engines(id) ON DELETE CASCADE,
 restored_at TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','matched','mismatch')),
 task_id TEXT NOT NULL DEFAULT '',
 requested_by TEXT NOT NULL DEFAULT '',
 observed_encrypted TEXT NOT NULL DEFAULT '',
 observed_revision BIGINT NOT NULL DEFAULT 0 CHECK(observed_revision>=0),
 draft_needs_review BIGINT NOT NULL DEFAULT 0 CHECK(draft_needs_review IN (0,1))
);
CREATE TABLE subscription_restore_endpoints (
 engine_id TEXT NOT NULL REFERENCES subscription_restore_engines(engine_id) ON DELETE CASCADE,
 service_id TEXT NOT NULL,
 public_host TEXT NOT NULL,
 public_port BIGINT NOT NULL CHECK(public_port BETWEEN 1 AND 65535),
 confirmed_at TEXT NOT NULL,
 PRIMARY KEY(engine_id,service_id)
);
