CREATE UNIQUE INDEX idx_agent_public_key ON agent_credentials(public_key);
CREATE TABLE web_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE enrollment_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 128),
  kind TEXT NOT NULL CHECK(kind IN ('vps','nat','relay')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  node_id TEXT REFERENCES nodes(id),
  revoked_at TEXT,
  created_by TEXT NOT NULL REFERENCES users(id)
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
