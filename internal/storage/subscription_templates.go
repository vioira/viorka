package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/vioira/viorka/internal/subscription"
)

const subscriptionTemplateColumns = `t.id,t.name,t.format,t.body,t.replacements_json,t.script,t.version,t.builtin,(SELECT count(*) FROM subscription_rules r WHERE r.template_id=t.id)`

func scanSubscriptionTemplate(row subscriptionRow) (subscription.Template, error) {
	var v subscription.Template
	var raw string
	err := row.Scan(&v.ID, &v.Name, &v.Format, &v.Body, &raw, &v.Script, &v.Version, &v.Builtin, &v.References)
	if err != nil {
		return v, err
	}
	err = json.Unmarshal([]byte(raw), &v.Replacements)
	return v, err
}
func (s *Store) SubscriptionTemplates(ctx context.Context, actor string) ([]subscription.Template, error) {
	if _, err := subscriptionViewer(ctx, s.db, actor); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT `+subscriptionTemplateColumns+` FROM subscription_templates t ORDER BY t.builtin DESC,t.name,t.id LIMIT 100`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []subscription.Template{}
	for rows.Next() {
		v, err := scanSubscriptionTemplate(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, v)
	}
	return items, rows.Err()
}
func (s *Store) SaveSubscriptionTemplate(ctx context.Context, actor, id string, edit subscription.TemplateEdit) (subscription.Template, error) {
	return s.saveSubscriptionTemplate(ctx, actor, id, edit, "subscription.template.save")
}

func (s *Store) saveSubscriptionTemplate(ctx context.Context, actor, id string, edit subscription.TemplateEdit, auditAction string) (subscription.Template, error) {
	var out, previous subscription.Template
	// Check authorization before compiling administrator-provided code.
	if _, err := subscriptionActor(ctx, s.db, actor, true); err != nil {
		return out, err
	}
	if err := subscription.ValidateTemplate(edit); err != nil {
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
		if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM subscription_templates`).Scan(&count); err != nil {
			return out, err
		}
		if count >= 100 {
			return out, subscription.ErrConflict
		}
		id, err = subscriptionRandom()
		if err != nil {
			return out, err
		}
	} else {
		current, e := scanSubscriptionTemplate(tx.QueryRowContext(ctx, `SELECT `+subscriptionTemplateColumns+` FROM subscription_templates t WHERE t.id=?`, id))
		if errors.Is(e, sql.ErrNoRows) {
			return out, subscription.ErrNotFound
		}
		if e != nil {
			return out, e
		}
		previous = current
		// A template's format is immutable: existing rules must not silently change clients.
		if current.Format != edit.Format || current.Version != edit.Version || current.References != edit.ExpectedReferences || (current.References > 0 && !edit.Confirm) {
			return out, subscription.ErrConflict
		}
	}
	var duplicate bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM subscription_templates WHERE name=? AND id!=?)`, edit.Name, id).Scan(&duplicate); err != nil {
		return out, err
	}
	if duplicate {
		return out, subscription.ErrConflict
	}
	replacements := edit.Replacements
	if replacements == nil {
		replacements = []subscription.Replacement{}
	}
	raw, err := json.Marshal(replacements)
	if err != nil {
		return out, err
	}
	if edit.Version == 0 {
		_, err = tx.ExecContext(ctx, `INSERT INTO subscription_templates(id,name,format,body,replacements_json,script) VALUES(?,?,?,?,?,?)`, id, edit.Name, edit.Format, edit.Body, string(raw), edit.Script)
	} else {
		var result sql.Result
		result, err = tx.ExecContext(ctx, `UPDATE subscription_templates SET name=?,body=?,replacements_json=?,script=?,version=version+1 WHERE id=? AND version=?`, edit.Name, edit.Body, string(raw), edit.Script, id, edit.Version)
		if err == nil {
			n, e := result.RowsAffected()
			if e != nil {
				return out, e
			}
			if n != 1 {
				return out, subscription.ErrConflict
			}
		}
	}
	if err != nil {
		return out, err
	}
	if edit.Version > 0 {
		if err = archiveTemplate(ctx, tx, previous); err != nil {
			return out, err
		}
	}
	if err = audit(ctx, tx, actor, auditAction, "subscription_template", id); err != nil {
		return out, err
	}
	out, err = scanSubscriptionTemplate(tx.QueryRowContext(ctx, `SELECT `+subscriptionTemplateColumns+` FROM subscription_templates t WHERE t.id=?`, id))
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
func (s *Store) DeleteSubscriptionTemplate(ctx context.Context, actor, id string, version int64) error {
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
	current, err := scanSubscriptionTemplate(tx.QueryRowContext(ctx, `SELECT `+subscriptionTemplateColumns+` FROM subscription_templates t WHERE t.id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return subscription.ErrNotFound
	}
	if err != nil {
		return err
	}
	if current.Builtin || current.References > 0 || current.Version != version {
		return subscription.ErrConflict
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM subscription_templates WHERE id=?`, id); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "subscription.template.delete", "subscription_template", id); err != nil {
		return err
	}
	return tx.Commit()
}
