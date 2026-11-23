package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/vioira/viorka/internal/alerts"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
)

type alertReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type storedAlertConfig struct {
	alerts.Config
	TemplateVersion int `json:"template_version"`
}

func encodeAlertConfig(c alerts.Config) ([]byte, error) {
	return json.Marshal(storedAlertConfig{Config: c, TemplateVersion: 1})
}

// Run once for saved legacy settings, before starting the alert workers.
func (s *Store) upgradeAlertTemplates(ctx context.Context) error {
	var raw string
	var revision int
	if err := s.db.QueryRowContext(ctx, "SELECT config_json,revision FROM alert_config WHERE id=1").Scan(&raw, &revision); err != nil || raw == "" {
		return err
	}
	var saved storedAlertConfig
	if err := json.Unmarshal([]byte(raw), &saved); err != nil {
		return err
	}
	if saved.TemplateVersion != 0 {
		return nil
	}
	saved.Config.UpgradeLegacyTemplates()
	saved.Config.Revision = revision + 1
	updated, err := encodeAlertConfig(saved.Config)
	if err != nil {
		return err
	}
	res, err := s.db.ExecContext(ctx, "UPDATE alert_config SET config_json=?,revision=revision+1 WHERE id=1 AND revision=?", string(updated), revision)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err != nil {
		return err
	} else if n != 1 {
		return auth.ErrConflict
	}
	return nil
}

func readAlertConfig(ctx context.Context, q alertReader) (alerts.Config, error) {
	var raw string
	var rev, delay int
	err := q.QueryRowContext(ctx, `SELECT config_json,alert_config.revision,COALESCE((SELECT offline_alert_minutes FROM system_settings WHERE id=1),0) FROM alert_config WHERE id=1`).Scan(&raw, &rev, &delay)
	c := alerts.Defaults()
	if err != nil {
		return c, err
	}
	if raw != "" {
		if err = json.Unmarshal([]byte(raw), &c); err != nil {
			return c, err
		}
	}
	for i, r := range c.Rules {
		if r.ID == alerts.Builtin {
			c.Rules[i].Enabled = delay > 0
			if delay > 0 {
				c.Rules[i].WindowMinutes = delay
			}
		}
	}
	c.Revision = rev
	return c, nil
}
func (s *Store) AlertSettings(ctx context.Context) (alerts.View, error) {
	tx, e := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if e != nil {
		return alerts.View{}, e
	}
	defer tx.Rollback()
	c, e := readAlertConfig(ctx, tx)
	v := alerts.View{Config: c, Delivery: map[string]alerts.DeliveryStatus{}, Credentials: map[string]bool{}}
	if e != nil {
		return v, e
	}
	rows, e := tx.QueryContext(ctx, "SELECT id,secret_encrypted!='',last_state,last_at,last_detail FROM alert_channels")
	if e != nil {
		return v, e
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var has bool
		var d alerts.DeliveryStatus
		if e = rows.Scan(&id, &has, &d.State, &d.At, &d.Detail); e != nil {
			return v, e
		}
		v.Credentials[id] = has
		if d.State != "" {
			v.Delivery[id] = d
		}
	}
	return v, rows.Err()
}
func (s *Store) SaveAlertSettings(ctx context.Context, actor string, edit alerts.Edit) error {
	s.alertConfigMu.Lock()
	defer s.alertConfigMu.Unlock()
	c := edit.Config
	if e := c.Validate(); e != nil {
		return e
	}
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	res, e := tx.ExecContext(ctx, "UPDATE alert_config SET revision=revision+1 WHERE id=1 AND revision=?", c.Revision)
	if e != nil {
		return e
	}
	if n, e := res.RowsAffected(); e != nil {
		return e
	} else if n != 1 {
		return auth.ErrConflict
	}
	old, e := readAlertConfig(ctx, tx)
	if e != nil {
		return e
	}
	prior := map[string]alerts.Channel{}
	for _, ch := range old.Channels {
		prior[ch.ID] = ch
	}
	for id := range edit.Secrets {
		if !slices.ContainsFunc(c.Channels, func(ch alerts.Channel) bool { return ch.ID == id }) {
			return auth.ErrInvalid
		}
	}
	for _, ch := range c.Channels {
		p, exists := prior[ch.ID]
		delete(prior, ch.ID)
		secret := edit.Secrets[ch.ID]
		if exists && (p.Kind != ch.Kind || p.Target != ch.Target) {
			if _, e = tx.ExecContext(ctx, "DELETE FROM alert_deliveries WHERE channel_id=?", ch.ID); e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, "UPDATE alert_channels SET last_state='',last_at='',last_detail='' WHERE id=?", ch.ID); e != nil {
				return e
			}
			if secret == "" && (p.Kind != ch.Kind || ch.Kind == "bark") {
				return auth.ErrInvalid
			}
		}
		if secret != "" {
			if !ch.ValidSecret(secret) {
				return auth.ErrInvalid
			}
			enc, e := s.sealEngine("notification/"+ch.ID, []byte(secret))
			if e != nil {
				return e
			}
			if _, e = tx.ExecContext(ctx, `INSERT INTO alert_channels(id,secret_encrypted) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET secret_encrypted=excluded.secret_encrypted`, ch.ID, enc); e != nil {
				return e
			}
		} else if !exists {
			return auth.ErrInvalid
		}
	}
	for id := range prior {
		if _, e = tx.ExecContext(ctx, "DELETE FROM alert_channels WHERE id=?", id); e != nil {
			return e
		}
	}
	priorRules := map[string]alerts.Rule{}
	for _, r := range old.Rules {
		priorRules[r.ID] = r
	}
	var delay int
	validatedNodes := map[string]bool{}
	nowMS := time.Now().UnixMilli()
	for i, r := range c.Rules {
		p, exists := priorRules[r.ID]
		if r.ID == alerts.Builtin && r.Enabled {
			delay = r.WindowMinutes
		}
		if exists && p.SameCondition(r) {
			delete(priorRules, r.ID)
			c.Rules[i].Since = p.Since
		} else {
			c.Rules[i].Since = nowMS
		}
		for _, node := range r.Nodes {
			if validatedNodes[node] || slices.Contains(p.Nodes, node) {
				continue
			}
			var present int
			if e = tx.QueryRowContext(ctx, "SELECT 1 FROM nodes WHERE id=?", node).Scan(&present); errors.Is(e, sql.ErrNoRows) {
				return auth.ErrInvalid
			} else if e != nil {
				return e
			}
			validatedNodes[node] = true
		}
	}
	for id := range priorRules {
		if _, e = tx.ExecContext(ctx, "DELETE FROM alert_states WHERE rule_id=?", id); e != nil {
			return e
		}
	}
	if _, e = tx.ExecContext(ctx, "UPDATE system_settings SET revision=revision+1,offline_alert_minutes=? WHERE id=1 AND offline_alert_minutes!=?", delay, delay); e != nil {
		return e
	}
	if delay == 0 {
		if _, e = tx.ExecContext(ctx, "UPDATE nodes SET offline_alert_since=NULL WHERE offline_alert_since IS NOT NULL"); e != nil {
			return e
		}
	}
	raw, e := encodeAlertConfig(c)
	if e != nil {
		return e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE alert_config SET config_json=? WHERE id=1", string(raw)); e != nil {
		return e
	}
	if e = audit(ctx, tx, actor, "notifications.configure", "settings", "notifications"); e != nil {
		return e
	}
	if e = s.commitChanges(tx, realtime.Change{Kind: "settings"}); e != nil {
		return e
	}
	s.refreshMetricRules(c)
	return nil
}

func (s *Store) refreshMetricRules(c alerts.Config) {
	s.hasMetricRules.Store(slices.ContainsFunc(c.Rules, func(r alerts.Rule) bool { return r.Enabled && r.Metric != "offline" }))
}

// Old databases may predate notification channels. Check for the table before
// deciding whether a missing key can be generated for a new installation.
func checkAlertKey(ctx context.Context, db *sql.DB, tableQuery string) error {
	var present bool
	if e := db.QueryRowContext(ctx, tableQuery).Scan(&present); e != nil {
		return e
	}
	if !present {
		return nil
	}
	var encrypted bool
	if e := db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM alert_channels WHERE secret_encrypted!='')").Scan(&encrypted); e != nil {
		return e
	}
	if encrypted {
		return errors.New("notification encryption key missing; restore the matching key before opening this database")
	}
	return nil
}
