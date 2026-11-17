package storage

import (
	"context"
	"database/sql"
	"errors"
	"time"

	auditlog "github.com/vioira/viorka/internal/audit"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
)

func (s *Store) CreateRegistrationToken(ctx context.Context, v auth.RegistrationToken, token string) error {
	encrypted, err := s.sealEngine("registration:"+v.ID, []byte(token))
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO node_registration_tokens(id,token_hash,token_encrypted,name,kind,name_prefix,max_uses,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, v.ID, auth.Hash(token), encrypted, v.Name, v.Kind, v.NamePrefix, v.MaxUses, v.CreatedBy, at(v.CreatedAt), at(v.ExpiresAt))
	if err != nil {
		return err
	}
	if err = audit(ctx, tx, v.CreatedBy, "node.registration_token.create", "node_registration_token", v.ID); err != nil {
		return err
	}
	return tx.Commit()
}

// RegistrationTokenValue only reveals an unexpired, unrevoked token.
func (s *Store) RegistrationTokenValue(ctx context.Context, id string) (string, error) {
	var encrypted string
	err := s.db.QueryRowContext(ctx, `SELECT token_encrypted FROM node_registration_tokens WHERE id=? AND revoked_at IS NULL AND expires_at>?`, id, now()).Scan(&encrypted)
	if errors.Is(err, sql.ErrNoRows) {
		return "", auth.ErrNotFound
	}
	if err != nil {
		return "", err
	}
	value, err := s.openEngine("registration:"+id, encrypted)
	return string(value), err
}
func (s *Store) RegistrationTokens(ctx context.Context, limit int, after string) ([]auth.RegistrationToken, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,name,kind,name_prefix,max_uses,used_count,created_by,created_at,expires_at,revoked_at FROM node_registration_tokens WHERE id>? ORDER BY id LIMIT ?`, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []auth.RegistrationToken{}
	for rows.Next() {
		var v auth.RegistrationToken
		var created, expires string
		var revoked sql.NullString
		if err = rows.Scan(&v.ID, &v.Name, &v.Kind, &v.NamePrefix, &v.MaxUses, &v.UsedCount, &v.CreatedBy, &created, &expires, &revoked); err != nil {
			return nil, err
		}
		if v.CreatedAt, err = time.Parse(time.RFC3339Nano, created); err != nil {
			return nil, err
		}
		if v.ExpiresAt, err = time.Parse(time.RFC3339Nano, expires); err != nil {
			return nil, err
		}
		if revoked.Valid {
			t, e := time.Parse(time.RFC3339Nano, revoked.String)
			if e != nil {
				return nil, e
			}
			v.RevokedAt = &t
		}
		items = append(items, v)
	}
	return items, rows.Err()
}
func (s *Store) RevokeRegistrationToken(ctx context.Context, actor, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE node_registration_tokens SET revoked_at=coalesce(revoked_at,?) WHERE id=?`, now(), id)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return auth.ErrNotFound
	}
	if err = audit(ctx, tx, actor, "node.registration_token.revoke", "node_registration_token", id); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) RegistrationRecords(ctx context.Context, id string, limit int, after string) ([]auth.RegistrationRecord, error) {
	var exists int
	if err := s.db.QueryRowContext(ctx, `SELECT 1 FROM node_registration_tokens WHERE id=?`, id).Scan(&exists); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, auth.ErrNotFound
		}
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT r.id,coalesce(n.id,''),coalesce(n.name,''),coalesce(n.state,'deleted'),r.created_at FROM node_registrations r LEFT JOIN nodes n ON n.id=r.node_id WHERE r.token_id=? AND r.id>? ORDER BY r.id LIMIT ?`, id, after, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []auth.RegistrationRecord{}
	for rows.Next() {
		var v auth.RegistrationRecord
		if err = rows.Scan(&v.ID, &v.NodeID, &v.Name, &v.State, &v.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, v)
	}
	return items, rows.Err()
}
func (s *Store) RegisterAgent(ctx context.Context, hash, key, name, hostname string) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	// Acquire the write lock before checking binding and quota, including across connections.
	var tokenID, kind, prefix, actor string
	err = tx.QueryRowContext(ctx, `UPDATE node_registration_tokens SET used_count=used_count WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? RETURNING id,kind,name_prefix,created_by`, hash, now()).Scan(&tokenID, &kind, &prefix, &actor)
	if errors.Is(err, sql.ErrNoRows) {
		return "", auth.ErrUnauthorized
	}
	if err != nil {
		return "", err
	}
	var existingToken string
	var node sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT token_id,node_id FROM node_registrations WHERE public_key=?`, key).Scan(&existingToken, &node)
	if err == nil {
		if existingToken != tokenID || !node.Valid {
			return "", auth.ErrConflict
		}
		var active bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM nodes n JOIN agent_credentials c ON c.node_id=n.id WHERE n.id=? AND n.state!='disabled' AND c.public_key=? AND c.status='active')`, node.String, key).Scan(&active); err != nil {
			return "", err
		}
		if !active {
			return "", auth.ErrUnauthorized
		}
		return node.String, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	var exists bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM agent_credentials WHERE public_key=?)`, key).Scan(&exists); err != nil {
		return "", err
	}
	if exists {
		return "", auth.ErrConflict
	}
	result, err := tx.ExecContext(ctx, `UPDATE node_registration_tokens SET used_count=used_count+1 WHERE id=? AND used_count<max_uses`, tokenID)
	if err != nil {
		return "", err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return "", err
	}
	if n == 0 {
		return "", auth.ErrRegistrationLimit
	}
	id := auth.Random()
	name = auth.RegistrationName(name, prefix, hostname, id)
	if _, err = tx.ExecContext(ctx, `INSERT INTO nodes(id,name,kind,state,created_by,created_at) VALUES(?,?,?,'offline',?,?)`, id, name, kind, actor, now()); err != nil {
		return "", err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO agent_credentials(id,node_id,public_key,status,created_at) VALUES(?,?,?,'active',?)`, auth.Random(), id, key, now()); err != nil {
		return "", err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO node_registrations(id,token_id,public_key,node_id,created_at) VALUES(?,?,?,?,?)`, auth.Random(), tokenID, key, id, now()); err != nil {
		return "", err
	}
	// Registration is performed by the Agent; the token's administrator is provenance, not a logged-in actor.
	if _, err = tx.ExecContext(ctx, `INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,source_ip,created_at) VALUES(?,NULL,'node.register','node',?,NULLIF(?,''),?)`, auth.Random(), id, auditlog.SourceIP(ctx), now()); err != nil {
		return "", err
	}
	return id, s.commitChanges(tx, realtime.Change{Kind: "nodes", NodeID: id})
}
