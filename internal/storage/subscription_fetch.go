package storage

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/subscription"
)

var (
	accessURL    = regexp.MustCompile(`(?i)https?://[^\s]+`)
	accessSecret = regexp.MustCompile(`(?i)\b[0-9a-f]{64}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`)
)

func safeSubscriptionUserAgent(userAgent, token string) string {
	userAgent = strings.ToValidUTF8(userAgent, "")
	userAgent = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, userAgent)
	userAgent = strings.ReplaceAll(userAgent, token, "[redacted]")
	userAgent = accessURL.ReplaceAllString(userAgent, "[url]")
	userAgent = accessSecret.ReplaceAllString(userAgent, "[redacted]")
	if len(userAgent) > subscription.MaxUserAgent {
		userAgent = userAgent[:subscription.MaxUserAgent]
		for !utf8.ValidString(userAgent) {
			userAgent = userAgent[:len(userAgent)-1]
		}
	}
	return userAgent
}

func recordSubscriptionAccessTx(ctx context.Context, tx *sql.Tx, id, userAgent, rule, format, result string) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO subscription_accesses(subscription_id,at,user_agent,rule_id,format,result) VALUES(?,?,?,?,?,?)`, id, now(), userAgent, rule, format, result); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `DELETE FROM subscription_accesses WHERE subscription_id=? AND id NOT IN (SELECT id FROM subscription_accesses WHERE subscription_id=? ORDER BY id DESC LIMIT 20)`, id, id)
	return err
}

// FetchSubscription authenticates the independent bearer token and checks the
// owner's current authorization for every selected, still-existing service in
// one transaction. User-Agent selects a format and never grants access.
func (s *Store) FetchSubscription(ctx context.Context, token, userAgent, override string, params ...map[string]string) (subscription.Rendered, error) {
	var out subscription.Rendered
	if len(token) != 64 || len(override) > 32 {
		return out, subscription.ErrNotFound
	}
	if _, err := hex.DecodeString(token); err != nil {
		return out, subscription.ErrNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	var id, owner string
	var port int
	err = tx.QueryRowContext(ctx, `SELECT id,owner_id,mihomo_port FROM subscriptions WHERE token_hash=?`, auth.Hash(token)).Scan(&id, &owner, &port)
	if errors.Is(err, sql.ErrNoRows) {
		return out, subscription.ErrNotFound
	}
	if err != nil {
		return out, err
	}
	safeUA := safeSubscriptionUserAgent(userAgent, token)
	format, ruleID := "", ""
	finish := func(result string, cause error) (subscription.Rendered, error) {
		if err := recordSubscriptionAccessTx(ctx, tx, id, safeUA, ruleID, format, result); err != nil {
			return subscription.Rendered{}, err
		}
		if err := tx.Commit(); err != nil {
			return subscription.Rendered{}, err
		}
		return out, cause
	}
	if _, err = subscriptionActor(ctx, tx, owner, false); errors.Is(err, subscription.ErrForbidden) {
		return finish("forbidden", subscription.ErrForbidden)
	} else if err != nil {
		return out, err
	}
	rules, err := subscriptionRulesTx(ctx, tx, id)
	if err != nil {
		return out, err
	}
	format, ruleID, err = subscription.SelectFormat(rules, userAgent, override)
	if errors.Is(err, subscription.ErrUnsupported) {
		return finish("unrecognized", subscription.ErrUnsupported)
	}
	if err != nil {
		return out, err
	}
	selectedRuleID := ruleID
	if override != "" {
		// The rule permits this format but did not match the User-Agent.
		ruleID = ""
	}
	refs, err := subscriptionRefsTx(ctx, tx, id)
	if err != nil {
		return out, err
	}
	checkedNodes := map[string]bool{}
	for _, ref := range refs {
		if checkedNodes[ref.ref.NodeID] {
			continue
		}
		checkedNodes[ref.ref.NodeID] = true
		var exists bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM nodes WHERE id=?)`, ref.ref.NodeID).Scan(&exists); err != nil {
			return out, err
		}
		if exists {
			if err = subscriptionExportAccessTx(ctx, tx, owner, ref.ref.NodeID); errors.Is(err, subscription.ErrForbidden) {
				return finish("forbidden", subscription.ErrForbidden)
			} else if err != nil {
				return out, err
			}
		}
	}
	nodes := make([]subscription.ClientNode, 0, len(refs))
	for _, ref := range refs {
		view, node, err := s.subscriptionServiceTx(ctx, tx, owner, ref.ref, ref.invalidated)
		if err != nil {
			return out, err
		}
		if view.Status == "forbidden" {
			return finish("forbidden", subscription.ErrForbidden)
		}
		if node != nil && subscription.Compatible(format, *node) {
			nodes = append(nodes, *node)
		}
	}
	if len(nodes) == 0 {
		return finish("no_services", subscription.ErrNoServices)
	}
	var templateID string
	for _, rule := range rules {
		if rule.ID == selectedRuleID {
			templateID = rule.TemplateID
			break
		}
	}
	template, err := scanSubscriptionTemplate(tx.QueryRowContext(ctx, `SELECT `+subscriptionTemplateColumns+` FROM subscription_templates t WHERE t.id=?`, templateID))
	if err != nil {
		return out, err
	}
	// Release the database transaction before evaluating user scripts.
	if err = tx.Commit(); err != nil {
		return out, err
	}
	request := subscription.TemplateRequest{UserAgent: userAgent, Params: map[string]string{}}
	if len(params) > 0 {
		request.Params = params[0]
	}
	out, renderErr := subscription.RenderTemplate(ctx, template, port, nodes, request)
	result := "ok"
	if renderErr != nil {
		result = "unavailable"
	}
	logTx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return subscription.Rendered{}, err
	}
	defer logTx.Rollback()
	if err = recordSubscriptionAccessTx(ctx, logTx, id, safeUA, ruleID, format, result); err != nil {
		return subscription.Rendered{}, err
	}
	if err = logTx.Commit(); err != nil {
		return subscription.Rendered{}, err
	}
	if renderErr != nil {
		return subscription.Rendered{}, errors.Join(subscription.ErrTemplate, renderErr)
	}
	return out, nil
}
