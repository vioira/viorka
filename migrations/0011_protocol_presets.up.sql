CREATE TABLE protocol_presets (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 128),
 protocol TEXT NOT NULL CHECK(protocol = 'vless'),
 config_json TEXT NOT NULL CHECK(json_valid(config_json)),
 created_at TEXT NOT NULL
);
