package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"

	"github.com/vioira/viorka/internal/subscription"
)

func subscriptionRandom() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}

func subscriptionActor(ctx context.Context, q engineQuery, actor string, adminOnly bool) (bool, error) {
	var role string
	var disabled bool
	err := q.QueryRowContext(ctx, `SELECT role,disabled FROM users WHERE id=?`, actor).Scan(&role, &disabled)
	if errors.Is(err, sql.ErrNoRows) {
		return false, subscription.ErrForbidden
	}
	if err != nil {
		return false, err
	}
	if disabled || (role != "admin" && (adminOnly || role != "operator")) {
		return false, subscription.ErrForbidden
	}
	return role == "admin", nil
}

func subscriptionViewer(ctx context.Context, q engineQuery, actor string) (bool, error) {
	var role string
	var disabled bool
	err := q.QueryRowContext(ctx, `SELECT role,disabled FROM users WHERE id=?`, actor).Scan(&role, &disabled)
	if errors.Is(err, sql.ErrNoRows) {
		return false, subscription.ErrForbidden
	}
	if err != nil {
		return false, err
	}
	if disabled || (role != "admin" && role != "operator" && role != "viewer") {
		return false, subscription.ErrForbidden
	}
	return role == "admin", nil
}

type subscriptionRow interface{ Scan(...any) error }

func scanSubscriptionRule(row subscriptionRow) (subscription.Rule, error) {
	var v subscription.Rule
	var conditions string
	err := row.Scan(&v.ID, &v.Name, &v.Format, &conditions, &v.Position, &v.Version, &v.Enabled, &v.References)
	if err != nil {
		return v, err
	}
	if err = json.Unmarshal([]byte(conditions), &v.Conditions); err != nil {
		return v, err
	}
	if v.Conditions == nil {
		v.Conditions = []subscription.Condition{}
	}
	return v, nil
}

const subscriptionRuleColumns = `r.id,r.name,r.format,r.conditions_json,r.position,r.version,r.enabled,(SELECT count(*) FROM subscription_rule_links l WHERE l.rule_id=r.id)`

func (s *Store) SubscriptionRules(ctx context.Context, actor string) ([]subscription.Rule, error) {
	if _, err := subscriptionViewer(ctx, s.db, actor); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+subscriptionRuleColumns+` FROM subscription_rules r ORDER BY r.position,r.id LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []subscription.Rule{}
	for rows.Next() {
		item, err := scanSubscriptionRule(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) SaveSubscriptionRule(ctx context.Context, actor, id string, edit subscription.RuleEdit) (subscription.Rule, error) {
	var out subscription.Rule
	if err := subscription.ValidateRule(edit); err != nil {
		return out, err
	}
	if len(id) > 128 || (id == "" && edit.Version != 0) || (id != "" && edit.Version < 1) {
		return out, subscription.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if _, err = subscriptionActor(ctx, tx, actor, true); err != nil {
		return out, err
	}
	if id == "" {
		var count int
		if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM subscription_rules`).Scan(&count); err != nil {
			return out, err
		}
		if count >= subscription.MaxRules {
			return out, subscription.ErrConflict
		}
		id, err = subscriptionRandom()
		if err != nil {
			return out, err
		}
	} else {
		current, e := scanSubscriptionRule(tx.QueryRowContext(ctx, `SELECT `+subscriptionRuleColumns+` FROM subscription_rules r WHERE r.id=?`, id))
		if errors.Is(e, sql.ErrNoRows) {
			return out, subscription.ErrNotFound
		}
		if e != nil {
			return out, e
		}
		if current.Version != edit.Version || current.References != edit.ExpectedReferences || (current.References > 1 && !edit.Confirm) {
			return out, subscription.ErrConflict
		}
	}
	conditions := edit.Conditions
	if conditions == nil {
		conditions = []subscription.Condition{}
	}
	raw, err := json.Marshal(conditions)
	if err != nil {
		return out, err
	}
	if edit.Version == 0 {
		result, e := tx.ExecContext(ctx, `INSERT INTO subscription_rules(id,name,format,conditions_json,position,version,enabled) VALUES(?,?,?,?,?,1,?) ON CONFLICT(name) DO NOTHING`, id, edit.Name, edit.Format, string(raw), edit.Position, edit.Enabled)
		if e != nil {
			return out, e
		}
		if n, e := result.RowsAffected(); e != nil {
			return out, e
		} else if n != 1 {
			return out, subscription.ErrConflict
		}
	} else {
		var duplicate bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_rules WHERE name=? AND id!=?)`, edit.Name, id).Scan(&duplicate); err != nil {
			return out, err
		}
		if duplicate {
			return out, subscription.ErrConflict
		}
		result, e := tx.ExecContext(ctx, `UPDATE subscription_rules SET name=?,format=?,conditions_json=?,position=?,enabled=?,version=version+1 WHERE id=? AND version=?`, edit.Name, edit.Format, string(raw), edit.Position, edit.Enabled, id, edit.Version)
		if e != nil {
			return out, e
		}
		if n, e := result.RowsAffected(); e != nil {
			return out, e
		} else if n != 1 {
			return out, subscription.ErrConflict
		}
	}
	if err = audit(ctx, tx, actor, "subscription.rule.save", "subscription_rule", id); err != nil {
		return out, err
	}
	out, err = scanSubscriptionRule(tx.QueryRowContext(ctx, `SELECT `+subscriptionRuleColumns+` FROM subscription_rules r WHERE r.id=?`, id))
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}

func (s *Store) DeleteSubscriptionRule(ctx context.Context, actor, id string, version int64) error {
	if id == "" || len(id) > 128 || version < 1 {
		return subscription.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = subscriptionActor(ctx, tx, actor, true); err != nil {
		return err
	}
	current, err := scanSubscriptionRule(tx.QueryRowContext(ctx, `SELECT `+subscriptionRuleColumns+` FROM subscription_rules r WHERE r.id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return subscription.ErrNotFound
	}
	if err != nil {
		return err
	}
	if current.References != 0 || current.Version != version {
		return subscription.ErrConflict
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM subscription_rules WHERE id=?`, id); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "subscription.rule.delete", "subscription_rule", id); err != nil {
		return err
	}
	return tx.Commit()
}
