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
CREATE TRIGGER web_session_ended AFTER DELETE ON web_sessions BEGIN
 UPDATE login_history SET ended_at=CASE WHEN expires_at<=strftime('%Y-%m-%dT%H:%M:%f000000Z','now') THEN expires_at ELSE strftime('%Y-%m-%dT%H:%M:%f000000Z','now') END,
 end_reason=CASE WHEN expires_at<=strftime('%Y-%m-%dT%H:%M:%f000000Z','now') THEN 'expired' ELSE 'revoked' END WHERE token_hash=OLD.token_hash AND ended_at='';
END;
CREATE TABLE passkeys (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 credential TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX passkeys_user ON passkeys(user_id);
CREATE TABLE webauthn_challenges (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
 binding TEXT NOT NULL, data TEXT NOT NULL, expires_at TEXT NOT NULL
);
