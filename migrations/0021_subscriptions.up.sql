CREATE TABLE subscription_templates (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 128),
 format TEXT NOT NULL CHECK(format IN ('mihomo','sing-box','loon')),
 body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 131072),
 replacements_json TEXT NOT NULL CHECK(json_valid(replacements_json) AND json_type(replacements_json)='array' AND json_array_length(replacements_json)<=32),
 script TEXT NOT NULL DEFAULT '' CHECK(length(script)<=16384),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 builtin INTEGER NOT NULL DEFAULT 0 CHECK(builtin IN (0,1))
);
INSERT INTO subscription_templates(id,name,format,body,replacements_json,builtin) VALUES('mihomo','Mihomo 默认模板','mihomo','mixed-port: {{port}}
allow-lan: false
bind-address: 127.0.0.1
mode: rule
ipv6: true
dns:
  enable: false
proxies: {{proxies}}
proxy-groups:
  - name: 节点选择
    type: select
    proxies: {{proxy_choices}}
rules:
  - IP-CIDR,127.0.0.0/8,DIRECT,no-resolve
  - IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
  - IP-CIDR,172.16.0.0/12,DIRECT,no-resolve
  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
  - IP-CIDR,169.254.0.0/16,DIRECT,no-resolve
  - IP-CIDR6,::1/128,DIRECT,no-resolve
  - IP-CIDR6,fc00::/7,DIRECT,no-resolve
  - IP-CIDR6,fe80::/10,DIRECT,no-resolve
  - MATCH,节点选择
','[]',1);
INSERT INTO subscription_templates(id,name,format,body,replacements_json,builtin) VALUES('sing-box','sing-box 默认模板','sing-box','{
  "log": {"level": "warn"},
  "dns": {"servers": [{"type": "local", "tag": "system-dns"}], "final": "system-dns"},
  "inbounds": [{"type": "tun", "tag": "tun-in", "address": ["172.19.0.1/30", "fdfe:dcba:9876::1/126"], "auto_route": true}],
  "outbounds": [
    {"type": "selector", "tag": "节点选择", "outbounds": {{proxy_choices}}, "default": {{default_proxy}}},
    {"type": "direct", "tag": "direct"},
    {{proxies}}
  ],
  "route": {
    "auto_detect_interface": true,
    "default_domain_resolver": "system-dns",
    "rules": [{"ip_is_private": true, "action": "route", "outbound": "direct"}],
    "final": "节点选择"
  }
}
','[]',1);
INSERT INTO subscription_templates(id,name,format,body,replacements_json,builtin) VALUES('loon','Loon 默认模板','loon','[General]
dns-server = system
udp-fallback-mode = REJECT

[Proxy]
{{proxies}}
[Proxy Group]
节点选择 = select, {{proxy_choices}}

[Rule]
IP-CIDR,127.0.0.0/8,DIRECT,no-resolve
IP-CIDR,10.0.0.0/8,DIRECT,no-resolve
IP-CIDR,172.16.0.0/12,DIRECT,no-resolve
IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
IP-CIDR,169.254.0.0/16,DIRECT,no-resolve
IP-CIDR6,::1/128,DIRECT,no-resolve
IP-CIDR6,fc00::/7,DIRECT,no-resolve
IP-CIDR6,fe80::/10,DIRECT,no-resolve
FINAL,节点选择
','[{"pattern": "(tls-profile=|fp=)chrome([,\\r\\n]|$)", "replacement": "${1}chrome147${2}", "parameter": "support-x25519mlkem768", "value": "true"}]',1);

CREATE TABLE subscription_rules (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 128),
 template_id TEXT NOT NULL REFERENCES subscription_templates(id) ON DELETE RESTRICT,
 conditions_json TEXT NOT NULL CHECK(json_valid(conditions_json) AND json_type(conditions_json)='array' AND json_array_length(conditions_json)<=32),
 position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 10000),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1))
);
-- These are application request identifiers documented by their upstreams.
-- Loon's native remote-profile User-Agent has not yet been verified; an
-- administrator must add the appropriate condition before enabling it.
INSERT INTO subscription_rules(id,name,template_id,conditions_json,position,enabled) VALUES
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
