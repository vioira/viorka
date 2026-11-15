CREATE TABLE subscription_rules (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 128),
 format TEXT NOT NULL CHECK(format IN ('mihomo','sing-box','loon')),
 conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json) AND json_type(conditions_json)='array' AND json_array_length(conditions_json)<=32),
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 10000),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
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
 mihomo_port INTEGER NOT NULL CHECK(mihomo_port BETWEEN 1 AND 65535),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
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
 position INTEGER NOT NULL CHECK(position>=0),
 invalidated INTEGER NOT NULL DEFAULT 0 CHECK(invalidated IN (0,1)),
 PRIMARY KEY(subscription_id,node_id,engine_id,service_id),
 UNIQUE(subscription_id,position)
);
CREATE INDEX subscription_service_links_engine ON subscription_service_links(node_id,engine_id,service_id);

CREATE TABLE subscription_accesses (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
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
 observed_revision INTEGER NOT NULL DEFAULT 0 CHECK(observed_revision>=0),
 draft_needs_review INTEGER NOT NULL DEFAULT 0 CHECK(draft_needs_review IN (0,1))
);
CREATE TABLE subscription_restore_endpoints (
 engine_id TEXT NOT NULL REFERENCES subscription_restore_engines(engine_id) ON DELETE CASCADE,
 service_id TEXT NOT NULL,
 public_host TEXT NOT NULL,
 public_port INTEGER NOT NULL CHECK(public_port BETWEEN 1 AND 65535),
 confirmed_at TEXT NOT NULL,
 PRIMARY KEY(engine_id,service_id)
);
