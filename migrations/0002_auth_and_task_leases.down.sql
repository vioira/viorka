DROP INDEX idx_agent_challenges_expiry;
DROP INDEX idx_agent_sessions_expiry;
DROP INDEX idx_web_sessions_expiry;
ALTER TABLE tasks DROP COLUMN lease_until;
ALTER TABLE tasks DROP COLUMN deadline_at;
DROP TABLE agent_sessions;
DROP TABLE agent_challenges;
DROP TABLE web_sessions;
DROP INDEX idx_agent_public_key;
