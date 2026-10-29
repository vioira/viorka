-- Destructive rollback for development only. Do not run on production data.
PRAGMA foreign_keys = OFF;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS metric_rollups;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS deployments;
DROP TABLE IF EXISTS config_revisions;
DROP TABLE IF EXISTS relay_rules;
DROP TABLE IF EXISTS proxy_services;
DROP TABLE IF EXISTS engines;
DROP TABLE IF EXISTS port_allocations;
DROP TABLE IF EXISTS node_addresses;
DROP TABLE IF EXISTS agent_credentials;
DROP TABLE IF EXISTS nodes;
DROP TABLE IF EXISTS users;
PRAGMA foreign_keys = ON;
