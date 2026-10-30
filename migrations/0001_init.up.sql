-- SQLite-first target model. Migration runner is NOT wired into the scaffold.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('admin','operator','viewer')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 128),
  kind TEXT NOT NULL CHECK(kind IN ('vps','nat','relay')),
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
  public_port INTEGER NOT NULL CHECK(public_port BETWEEN 1 AND 65535),
  private_host TEXT NOT NULL,
  private_port INTEGER NOT NULL CHECK(private_port BETWEEN 1 AND 65535),
  transport TEXT NOT NULL CHECK(transport IN ('tcp','udp')),
  owner TEXT NOT NULL CHECK(owner IN ('provider','node','manual')),
  state TEXT NOT NULL DEFAULT 'assigned' CHECK(state IN ('assigned','active','inactive')),
  provider_name TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(node_id,public_host,public_port,transport)
);

CREATE TABLE IF NOT EXISTS engines (
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
  listen_port INTEGER NOT NULL CHECK(listen_port BETWEEN 1 AND 65535),
  transport TEXT NOT NULL CHECK(transport IN ('tcp','udp','both')),
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proxy_services_node ON proxy_services(node_id);

CREATE TABLE IF NOT EXISTS relay_rules (
  id TEXT PRIMARY KEY,
  source_node_id TEXT NOT NULL REFERENCES nodes(id),
  destination_node_id TEXT REFERENCES nodes(id),
  engine_id TEXT NOT NULL REFERENCES engines(id),
  listen_host TEXT NOT NULL,
  listen_port INTEGER NOT NULL CHECK(listen_port BETWEEN 1 AND 65535),
  target_host TEXT NOT NULL,
  target_port INTEGER NOT NULL CHECK(target_port BETWEEN 1 AND 65535),
  transport TEXT NOT NULL CHECK(transport IN ('tcp','udp')),
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
);

CREATE TABLE IF NOT EXISTS config_revisions (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
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
  desired_revision INTEGER NOT NULL,
  observed_revision INTEGER,
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
  revision INTEGER,
  state TEXT NOT NULL CHECK(state IN ('queued','dispatched','accepted','running','succeeded','failed','rolled_back','cancelled')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(max_attempts >= 1),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(node_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_tasks_node_state ON tasks(node_id,state,created_at);

CREATE TABLE IF NOT EXISTS metric_rollups (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  bucket_start TEXT NOT NULL,
  period_seconds INTEGER NOT NULL CHECK(period_seconds > 0),
  cpu_avg REAL,
  memory_used_bytes INTEGER,
  rx_bytes INTEGER,
  tx_bytes INTEGER,
  PRIMARY KEY(node_id,bucket_start,period_seconds)
);

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
