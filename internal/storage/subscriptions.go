package storage

import (
	"context"
	"database/sql"
	"errors"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/subscription"
)

type storedServiceRef struct {
	ref         subscription.ServiceRef
	invalidated bool
}

func subscriptionBaseTx(ctx context.Context, tx *sql.Tx, actor, id string, write bool) (subscription.Subscription, error) {
	var v subscription.Subscription
	if id == "" || len(id) > 128 {
		return v, subscription.ErrInvalid
	}
	var admin bool
	var err error
	if write {
		admin, err = subscriptionActor(ctx, tx, actor, false)
	} else {
		admin, err = subscriptionViewer(ctx, tx, actor)
	}
	if err != nil {
		return v, err
	}
	err = tx.QueryRowContext(ctx, `SELECT id,name,owner_id,mihomo_port,version,created_at,updated_at,token_hash IS NULL FROM subscriptions WHERE id=?`, id).Scan(&v.ID, &v.Name, &v.OwnerID, &v.Port, &v.Version, &v.CreatedAt, &v.UpdatedAt, &v.Revoked)
	if errors.Is(err, sql.ErrNoRows) {
		return v, subscription.ErrNotFound
	}
	if err != nil {
		return v, err
	}
	if !admin && v.OwnerID != actor {
		return v, subscription.ErrForbidden
	}
	return v, nil
}

func subscriptionRefsTx(ctx context.Context, tx *sql.Tx, id string) ([]storedServiceRef, error) {
	rows, err := tx.QueryContext(ctx, `SELECT node_id,engine_id,service_id,invalidated FROM subscription_service_links WHERE subscription_id=? ORDER BY position`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []storedServiceRef{}
	for rows.Next() {
		var item storedServiceRef
		if err = rows.Scan(&item.ref.NodeID, &item.ref.EngineID, &item.ref.ServiceID, &item.invalidated); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func subscriptionRulesTx(ctx context.Context, tx *sql.Tx, id string) ([]subscription.Rule, error) {
	rows, err := tx.QueryContext(ctx, `SELECT `+subscriptionRuleColumns+` FROM subscription_rules r JOIN subscription_rule_links l ON l.rule_id=r.id WHERE l.subscription_id=? ORDER BY r.position,r.id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []subscription.Rule{}
	for rows.Next() {
		v, err := scanSubscriptionRule(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, v)
	}
	return items, rows.Err()
}

func (s *Store) subscriptionDetailTx(ctx context.Context, tx *sql.Tx, actor, id string, write bool) (subscription.Subscription, error) {
	v, err := subscriptionBaseTx(ctx, tx, actor, id, write)
	if err != nil {
		return v, err
	}
	var last subscription.AccessSummary
	err = tx.QueryRowContext(ctx, `SELECT at,format,result FROM subscription_accesses WHERE subscription_id=? ORDER BY id DESC LIMIT 1`, id).Scan(&last.At, &last.Format, &last.Result)
	if err == nil {
		v.LastAccess = &last
	} else if !errors.Is(err, sql.ErrNoRows) {
		return v, err
	}
	rules, err := subscriptionRulesTx(ctx, tx, id)
	if err != nil {
		return v, err
	}
	v.RuleIDs = make([]string, 0, len(rules))
	for _, rule := range rules {
		v.RuleIDs = append(v.RuleIDs, rule.ID)
	}
	refs, err := subscriptionRefsTx(ctx, tx, id)
	if err != nil {
		return v, err
	}
	v.Services = make([]subscription.ServiceView, 0, len(refs))
	for _, ref := range refs {
		view, _, err := s.subscriptionServiceTx(ctx, tx, v.OwnerID, ref.ref, ref.invalidated)
		if err != nil {
			return v, err
		}
		v.Services = append(v.Services, view)
	}
	return v, nil
}

func (s *Store) Subscriptions(ctx context.Context, actor, after string, limit int, query, status string) ([]subscription.Subscription, string, error) {
	if status == "" {
		status = "all"
	}
	if len(after) > 128 || !validSubscriptionSearch(after) || limit < 1 || limit > 100 || !validSubscriptionSearch(query) || (status != "all" && status != "attention" && status != "revoked") {
		return nil, "", subscription.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, "", err
	}
	defer tx.Rollback()
	admin, err := subscriptionViewer(ctx, tx, actor)
	if err != nil {
		return nil, "", err
	}
	// Escape SQL wildcards so filtering is literal substring search.
	pattern := "%" + strings.NewReplacer("!", "!!", "%", "!%", "_", "!_").Replace(strings.TrimSpace(query)) + "%"
	items := []subscription.Subscription{}
	for {
		rows, err := tx.QueryContext(ctx, `SELECT s.id FROM subscriptions s WHERE s.id>? AND (?=1 OR s.owner_id=?) AND lower(s.name) LIKE lower(?) ESCAPE '!' AND (?!='revoked' OR s.token_hash IS NULL) ORDER BY s.id LIMIT ?`, after, admin, actor, pattern, status, limit+1)
		if err != nil {
			return nil, "", err
		}
		ids := []string{}
		for rows.Next() {
			var id string
			if err = rows.Scan(&id); err != nil {
				break
			}
			ids = append(ids, id)
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		if err != nil {
			return nil, "", err
		}
		for _, id := range ids {
			item, err := s.subscriptionDetailTx(ctx, tx, actor, id, false)
			if err != nil {
				return nil, "", err
			}
			if status == "attention" && !slices.ContainsFunc(item.Services, func(v subscription.ServiceView) bool { return v.Status != "available" }) {
				continue
			}
			if len(items) == limit {
				return items, items[len(items)-1].ID, tx.Commit()
			}
			items = append(items, item)
		}
		if len(ids) < limit+1 {
			break
		}
		after = ids[len(ids)-1]
	}
	return items, "", tx.Commit()
}

func validSubscriptionSearch(query string) bool {
	return len(query) <= 256 && utf8.ValidString(query) && strings.IndexFunc(query, unicode.IsControl) < 0
}

func (s *Store) Subscription(ctx context.Context, actor, id string) (subscription.Subscription, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return subscription.Subscription{}, err
	}
	defer tx.Rollback()
	v, err := s.subscriptionDetailTx(ctx, tx, actor, id, false)
	if err != nil {
		return v, err
	}
	return v, tx.Commit()
}

// SaveSubscription returns a secret only on creation. Plaintext tokens are
// never persisted; changing an existing subscription does not rotate one.
func (s *Store) SaveSubscription(ctx context.Context, actor, id string, edit subscription.Edit) (subscription.Subscription, string, error) {
	var out subscription.Subscription
	if err := subscription.ValidateEdit(edit); err != nil {
		return out, "", err
	}
	if len(id) > 128 || (id == "" && edit.Version != 0) || (id != "" && edit.Version < 1) {
		return out, "", subscription.ErrInvalid
	}
	var secret string
	var err error
	if id == "" {
		id, err = subscriptionRandom()
		if err != nil {
			return out, "", err
		}
		secret, err = subscriptionRandom()
		if err != nil {
			return out, "", err
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return out, "", err
	}
	defer tx.Rollback()
	if _, err = subscriptionActor(ctx, tx, actor, false); err != nil {
		return out, "", err
	}
	owner := actor
	oldServices := map[subscription.ServiceRef]bool{}
	oldRules := map[string]bool{}
	if edit.Version > 0 {
		current, err := subscriptionBaseTx(ctx, tx, actor, id, true)
		if err != nil {
			return out, "", err
		}
		if current.Version != edit.Version {
			return out, "", subscription.ErrConflict
		}
		owner = current.OwnerID
		if _, err = subscriptionActor(ctx, tx, owner, false); err != nil {
			return out, "", err
		}
		refs, err := subscriptionRefsTx(ctx, tx, id)
		if err != nil {
			return out, "", err
		}
		for _, ref := range refs {
			oldServices[ref.ref] = ref.invalidated
		}
		rules, err := subscriptionRulesTx(ctx, tx, id)
		if err != nil {
			return out, "", err
		}
		for _, rule := range rules {
			oldRules[rule.ID] = true
		}
	}
	for _, ruleID := range edit.RuleIDs {
		var enabled bool
		err = tx.QueryRowContext(ctx, `SELECT enabled FROM subscription_rules WHERE id=?`, ruleID).Scan(&enabled)
		if errors.Is(err, sql.ErrNoRows) {
			return out, "", subscription.ErrInvalid
		}
		if err != nil {
			return out, "", err
		}
		if !enabled && !oldRules[ruleID] {
			return out, "", subscription.ErrInvalid
		}
	}
	for _, ref := range edit.Reselect {
		invalidated, present := oldServices[ref]
		if !present || !invalidated {
			return out, "", subscription.ErrInvalid
		}
		view, _, err := s.subscriptionServiceTx(ctx, tx, owner, ref, false)
		if err != nil {
			return out, "", err
		}
		if view.Status == "forbidden" {
			return out, "", subscription.ErrForbidden
		}
		if view.Status != "available" {
			return out, "", subscription.ErrConflict
		}
		oldServices[ref] = false
	}
	for _, ref := range edit.Services {
		invalidated, present := oldServices[ref]
		view, _, err := s.subscriptionServiceTx(ctx, tx, owner, ref, invalidated)
		if err != nil {
			return out, "", err
		}
		if view.Status == "forbidden" {
			return out, "", subscription.ErrForbidden
		}
		if view.Status != "available" && !present {
			return out, "", subscription.ErrConflict
		}
	}
	if edit.Version == 0 {
		var count int
		if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM subscriptions WHERE owner_id=?`, owner).Scan(&count); err != nil {
			return out, "", err
		}
		if count >= 500 {
			return out, "", subscription.ErrConflict
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO subscriptions(id,owner_id,name,token_hash,mihomo_port,version,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(owner_id,name) DO NOTHING`, id, owner, edit.Name, auth.Hash(secret), edit.Port, now(), now())
		if err != nil {
			return out, "", err
		}
		if n, err := result.RowsAffected(); err != nil {
			return out, "", err
		} else if n != 1 {
			return out, "", subscription.ErrConflict
		}
	} else {
		var duplicate bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM subscriptions WHERE owner_id=? AND name=? AND id!=?)`, owner, edit.Name, id).Scan(&duplicate); err != nil {
			return out, "", err
		}
		if duplicate {
			return out, "", subscription.ErrConflict
		}
		result, err := tx.ExecContext(ctx, `UPDATE subscriptions SET name=?,mihomo_port=?,version=version+1,updated_at=? WHERE id=? AND version=?`, edit.Name, edit.Port, now(), id, edit.Version)
		if err != nil {
			return out, "", err
		}
		if n, err := result.RowsAffected(); err != nil {
			return out, "", err
		} else if n != 1 {
			return out, "", subscription.ErrConflict
		}
		if _, err = tx.ExecContext(ctx, `DELETE FROM subscription_rule_links WHERE subscription_id=?`, id); err != nil {
			return out, "", err
		}
		if _, err = tx.ExecContext(ctx, `DELETE FROM subscription_service_links WHERE subscription_id=?`, id); err != nil {
			return out, "", err
		}
	}
	for _, rule := range edit.RuleIDs {
		if _, err = tx.ExecContext(ctx, `INSERT INTO subscription_rule_links(subscription_id,rule_id) VALUES(?,?)`, id, rule); err != nil {
			return out, "", err
		}
	}
	for position, ref := range edit.Services {
		if _, err = tx.ExecContext(ctx, `INSERT INTO subscription_service_links(subscription_id,node_id,engine_id,service_id,position,invalidated) VALUES(?,?,?,?,?,?)`, id, ref.NodeID, ref.EngineID, ref.ServiceID, position, oldServices[ref]); err != nil {
			return out, "", err
		}
	}
	action := "subscription.create"
	if edit.Version > 0 {
		action = "subscription.update"
	}
	if err = audit(ctx, tx, actor, action, "subscription", id); err != nil {
		return out, "", err
	}
	out, err = s.subscriptionDetailTx(ctx, tx, actor, id, true)
	if err != nil {
		return out, "", err
	}
	if err = tx.Commit(); err != nil {
		return out, "", err
	}
	return out, secret, nil
}

func (s *Store) RotateSubscription(ctx context.Context, actor, id string, version int64, revoke bool) (string, error) {
	if version < 1 {
		return "", subscription.ErrInvalid
	}
	var secret string
	var err error
	if !revoke {
		secret, err = subscriptionRandom()
		if err != nil {
			return "", err
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	current, err := subscriptionBaseTx(ctx, tx, actor, id, true)
	if err != nil {
		return "", err
	}
	if current.Version != version {
		return "", subscription.ErrConflict
	}
	var hash any
	if !revoke {
		hash = auth.Hash(secret)
	}
	result, err := tx.ExecContext(ctx, `UPDATE subscriptions SET token_hash=?,version=version+1,updated_at=? WHERE id=? AND version=?`, hash, now(), id, version)
	if err != nil {
		return "", err
	}
	if n, err := result.RowsAffected(); err != nil {
		return "", err
	} else if n != 1 {
		return "", subscription.ErrConflict
	}
	action := "subscription.rotate"
	if revoke {
		action = "subscription.revoke"
	}
	if err = audit(ctx, tx, actor, action, "subscription", id); err != nil {
		return "", err
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	return secret, nil
}

func (s *Store) DeleteSubscription(ctx context.Context, actor, id string, version int64) error {
	if version < 1 {
		return subscription.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	current, err := subscriptionBaseTx(ctx, tx, actor, id, true)
	if err != nil {
		return err
	}
	if current.Version != version {
		return subscription.ErrConflict
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM subscriptions WHERE id=? AND version=?`, id, version); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "subscription.delete", "subscription", id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) SubscriptionAccess(ctx context.Context, actor, id string) ([]subscription.Access, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err = subscriptionBaseTx(ctx, tx, actor, id, false); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,at,user_agent,rule_id,format,result FROM subscription_accesses WHERE subscription_id=? ORDER BY id DESC LIMIT 20`, id)
	if err != nil {
		return nil, err
	}
	items := []subscription.Access{}
	for rows.Next() {
		var v subscription.Access
		if err = rows.Scan(&v.ID, &v.At, &v.UserAgent, &v.RuleID, &v.Format, &v.Result); err != nil {
			break
		}
		items = append(items, v)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return nil, err
	}
	return items, tx.Commit()
}

func (s *Store) ClearSubscriptionAccess(ctx context.Context, actor, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = subscriptionBaseTx(ctx, tx, actor, id, true); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM subscription_accesses WHERE subscription_id=?`, id); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "subscription.access.clear", "subscription", id); err != nil {
		return err
	}
	return tx.Commit()
}
