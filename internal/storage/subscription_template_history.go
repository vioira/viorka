package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/vioira/viorka/internal/subscription"
)

const maxPreviousTemplates = 10

func archiveTemplate(ctx context.Context, tx *sql.Tx, t subscription.Template) error {
	raw, err := json.Marshal(t.Replacements)
	if err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO subscription_template_history(template_id,version,name,body,replacements_json,script,archived_at) VALUES(?,?,?,?,?,?,?)`, t.ID, t.Version, t.Name, t.Body, string(raw), t.Script, now()); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM subscription_template_history WHERE template_id=? AND version<=?`, t.ID, t.Version-maxPreviousTemplates)
	return err
}

func adminTemplate(ctx context.Context, q engineQuery, actor, id string) (subscription.Template, error) {
	if _, err := subscriptionActor(ctx, q, actor, true); err != nil {
		return subscription.Template{}, err
	}
	if id == "" || len(id) > 128 {
		return subscription.Template{}, subscription.ErrInvalid
	}
	t, err := scanSubscriptionTemplate(q.QueryRowContext(ctx, `SELECT `+subscriptionTemplateColumns+` FROM subscription_templates t WHERE t.id=?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return t, subscription.ErrNotFound
	}
	return t, err
}

func (s *Store) SubscriptionTemplateHistory(ctx context.Context, actor, id string) (subscription.TemplateRevisions, error) {
	out := subscription.TemplateRevisions{Items: []subscription.TemplateRevision{}}
	if _, err := adminTemplate(ctx, s.db, actor, id); err != nil {
		return out, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT version,archived_at FROM subscription_template_history WHERE template_id=? ORDER BY version DESC LIMIT ?`, id, maxPreviousTemplates)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var rev subscription.TemplateRevision
		if err := rows.Scan(&rev.Version, &rev.ArchivedAt); err != nil {
			return out, err
		}
		out.Items = append(out.Items, rev)
	}
	return out, rows.Err()
}

func (s *Store) SubscriptionTemplateVersion(ctx context.Context, actor, id string, version int64) (subscription.Template, error) {
	current, err := adminTemplate(ctx, s.db, actor, id)
	if err != nil {
		return current, err
	}
	if version < 1 {
		return current, subscription.ErrInvalid
	}
	var raw string
	err = s.db.QueryRowContext(ctx, `SELECT version,name,body,replacements_json,script FROM subscription_template_history WHERE template_id=? AND version=?`, id, version).Scan(&current.Version, &current.Name, &current.Body, &raw, &current.Script)
	if errors.Is(err, sql.ErrNoRows) {
		return subscription.Template{}, subscription.ErrNotFound
	}
	if err != nil {
		return subscription.Template{}, err
	}
	err = json.Unmarshal([]byte(raw), &current.Replacements)
	return current, err
}

// Restore uses the immutable archived content and the same CAS, reference confirmation,
// retention and audit transaction as an ordinary save. Versions always move forward.
func (s *Store) RestoreSubscriptionTemplate(ctx context.Context, actor, id string, req subscription.TemplateRestore) (subscription.Template, error) {
	if req.Version <= req.SourceVersion || req.SourceVersion < 1 || !req.Confirm {
		return subscription.Template{}, subscription.ErrInvalid
	}
	history, err := s.SubscriptionTemplateVersion(ctx, actor, id, req.SourceVersion)
	if err != nil {
		return subscription.Template{}, err
	}
	return s.saveSubscriptionTemplate(ctx, actor, id, subscription.TemplateEdit{Name: history.Name, Format: history.Format, Body: history.Body, Replacements: history.Replacements, Script: history.Script, Version: req.Version, ExpectedReferences: req.ExpectedReferences, Confirm: req.Confirm}, "subscription.template.restore")
}
