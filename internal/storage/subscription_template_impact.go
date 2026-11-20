package storage

import (
	"context"
	"database/sql"
	"errors"

	"github.com/vioira/viorka/internal/subscription"
)

const usesEnabledTemplate = `EXISTS(SELECT 1 FROM subscription_rule_links l JOIN subscription_rules r ON r.id=l.rule_id WHERE l.subscription_id=s.id AND r.enabled=1 AND r.template_id=?)`

func (s *Store) SubscriptionTemplateImpact(ctx context.Context, actor, id, after string, limit int) (subscription.TemplateImpactPage, error) {
	out := subscription.TemplateImpactPage{Items: []subscription.TemplateSubscriber{}}
	if _, err := adminTemplate(ctx, s.db, actor, id); err != nil {
		return out, err
	}
	if len(after) > 128 || limit < 1 || limit > 50 {
		return out, subscription.ErrInvalid
	}
	rows, err := s.db.QueryContext(ctx, `SELECT s.id,s.name,u.username FROM subscriptions s JOIN users u ON u.id=s.owner_id WHERE `+usesEnabledTemplate+` AND s.id>? ORDER BY s.id LIMIT ?`, id, after, limit+1)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var row subscription.TemplateSubscriber
		if err := rows.Scan(&row.ID, &row.Name, &row.OwnerName); err != nil {
			return out, err
		}
		if len(out.Items) == limit {
			out.NextCursor = out.Items[limit-1].ID
			break
		}
		out.Items = append(out.Items, row)
	}
	return out, rows.Err()
}

func (s *Store) CompareSubscriptionTemplate(ctx context.Context, actor, id, subscriber string, draft subscription.TemplateEdit, request subscription.TemplateRequest) (subscription.TemplateComparison, error) {
	var out subscription.TemplateComparison
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	current, err := adminTemplate(ctx, tx, actor, id)
	if err != nil {
		return out, err
	}
	if current.Version != draft.Version || current.Format != draft.Format {
		return out, subscription.ErrConflict
	}
	if subscriber == "" || len(subscriber) > 128 {
		return out, subscription.ErrInvalid
	}
	if err = subscription.ValidateTemplateRequest(request); err != nil {
		return out, err
	}
	var port int
	var owner string
	err = tx.QueryRowContext(ctx, `SELECT s.mihomo_port,s.owner_id FROM subscriptions s WHERE s.id=? AND `+usesEnabledTemplate, subscriber, id).Scan(&port, &owner)
	if errors.Is(err, sql.ErrNoRows) {
		return out, subscription.ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if _, err = subscriptionActor(ctx, tx, owner, false); err != nil {
		return out, err
	}
	services, err := s.subscriptionExportNodesTx(ctx, tx, subscriber, owner, current.Format)
	if err != nil {
		return out, err
	}
	if len(services) == 0 {
		return out, subscription.ErrNoServices
	}
	nodes := subscription.MaskTemplateNodes(services)
	if err = tx.Commit(); err != nil {
		return out, err
	}
	if err = subscription.ValidateTemplate(draft); err != nil {
		return out, err
	}
	before, errBefore := subscription.RenderTemplate(ctx, current, port, nodes, request)
	after, errAfter := subscription.RenderTemplate(ctx, subscription.Template{Format: draft.Format, Body: draft.Body, Replacements: draft.Replacements, Script: draft.Script}, port, nodes, request)
	if err := ctx.Err(); err != nil {
		return out, err
	}
	out = subscription.CompareTemplateOutput(before.Body, after.Body)
	out.Services = len(nodes)
	out.BeforeInvalid = errBefore != nil
	out.AfterInvalid = errAfter != nil
	return out, nil
}
