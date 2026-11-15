CREATE TABLE node_registration_tokens (
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 128),
 kind TEXT NOT NULL CHECK(kind IN ('vps','nat')),
 name_prefix TEXT NOT NULL CHECK(length(name_prefix)<=32),
 max_uses INTEGER NOT NULL CHECK(max_uses BETWEEN 1 AND 10000),
 used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count>=0 AND used_count<=max_uses),
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
