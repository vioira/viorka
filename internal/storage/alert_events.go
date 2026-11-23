package storage

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/vioira/viorka/internal/alerts"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

// Windows belong to the admitted telemetry run. Commit the incident, inbox
// entry and all channel jobs together before advancing admission watermarks.
func (s *Store) EvaluateAlerts(ctx context.Context, b v1.TelemetryBatch, c v1.TelemetrySettings, http bool, floor [3]uint64, now time.Time, w *alerts.Windows) error {
	if !s.hasMetricRules.Load() {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	cfg, e := readAlertConfig(ctx, tx)
	if e != nil {
		return e
	}
	next := w.Candidate()
	decisions := next.Evaluate(cfg.Rules, b, c, http, floor, now)
	if len(decisions) == 0 {
		*w = next
		s.recordAlertReadings(b.NodeID, next.Readings(), now)
		return nil
	}
	var name string
	if e = tx.QueryRowContext(ctx, "SELECT name FROM nodes WHERE id=?", b.NodeID).Scan(&name); e != nil {
		return e
	}
	changed := false
	states := map[string]*alertState{}
	for _, d := range decisions {
		st, ok := states[d.Rule.ID]
		if !ok {
			st, e = readAlertState(ctx, tx, d.Rule.ID, b.NodeID)
			if e != nil {
				return e
			}
			states[d.Rule.ID] = st
		}
		sent, e := st.apply(ctx, tx, cfg, b.NodeID, name, d, now)
		if e != nil {
			return e
		}
		changed = changed || sent
	}
	if e = s.commitAlertEvents(tx, changed); e == nil {
		*w = next
		s.recordAlertReadings(b.NodeID, next.Readings(), now)
	}
	return e
}
func (s *Store) commitAlertEvents(tx *sql.Tx, changed bool, changes ...realtime.Change) error {
	if changed {
		changes = append(changes, realtime.Change{Kind: "notifications"})
	}
	return s.commitChanges(tx, changes...)
}
func applyAlert(ctx context.Context, tx *sql.Tx, c alerts.Config, node, name string, d alerts.Decision, now time.Time) (bool, error) {
	st, e := readAlertState(ctx, tx, d.Rule.ID, node)
	if e != nil {
		return false, e
	}
	return st.apply(ctx, tx, c, node, name, d, now)
}

type alertState struct{ start, sent, last, period int64 }

func readAlertState(ctx context.Context, tx *sql.Tx, id, node string) (*alertState, error) {
	var st alertState
	e := tx.QueryRowContext(ctx, "SELECT started_ms,last_sent_ms,evaluated_ms,period_ms FROM alert_states WHERE rule_id=? AND node_id=?", id, node).Scan(&st.start, &st.sent, &st.last, &st.period)
	if errors.Is(e, sql.ErrNoRows) {
		e = nil
	}
	return &st, e
}
func (st *alertState) apply(ctx context.Context, tx *sql.Tx, c alerts.Config, node, name string, d alerts.Decision, now time.Time) (bool, error) {
	start, sent, last, period := st.start, st.sent, st.last, st.period
	var e error
	ms := d.At.UnixMilli()
	if ms <= last {
		return false, nil
	}
	oldStart := start
	newPeriod := period != 0 && d.Period != period
	if newPeriod {
		start = 0
	}
	state := ""
	switch {
	case d.High && start == 0:
		start = ms
		if d.Rule.Metric == "offline" {
			start -= int64(d.Value * 60000)
		}
		state = "trigger"
	case d.High && d.Rule.RepeatMinutes > 0 && now.UnixMilli()-sent >= int64(d.Rule.RepeatMinutes)*60000:
		state = "repeat"
	case d.Normal && (start != 0 || newPeriod):
		start = 0
		if oldStart > 0 && d.Rule.Recovery {
			state = "recovery"
		}
	default:
		return false, nil
	}
	if state != "" {
		sent = now.UnixMilli()
	}
	if _, e = tx.ExecContext(ctx, `INSERT INTO alert_states(rule_id,node_id,started_ms,last_sent_ms,evaluated_ms,period_ms) VALUES(?,?,?,?,?,?) ON CONFLICT(rule_id,node_id) DO UPDATE SET started_ms=excluded.started_ms,last_sent_ms=excluded.last_sent_ms,evaluated_ms=excluded.evaluated_ms,period_ms=excluded.period_ms`, d.Rule.ID, node, start, sent, ms, d.Period); e != nil {
		return false, e
	}
	*st = alertState{start, sent, ms, d.Period}
	if state == "" {
		return false, nil
	}
	started := start
	if state == "recovery" {
		started = oldStart
	}
	if d.Rule.Metric == "offline" && state != "recovery" {
		started = ms - int64(d.Value*60000)
	}
	zone, e := time.LoadLocation(c.Timezone)
	if e != nil {
		return false, e
	}
	var msg alerts.Message
	for _, t := range c.Templates {
		if t.ID == d.Rule.Template {
			msg = t.Render(state, name, d.Rule, d.Value, d.At, time.UnixMilli(started), zone)
			break
		}
	}
	if _, e = tx.ExecContext(ctx, "INSERT INTO notifications(id,node_id,created_at,title,event_kind,message) VALUES(?,?,?,?,?,?)", auth.Random(), node, at(d.At), msg.Title, state, msg.Body); e != nil {
		return false, e
	}
	if _, e = tx.ExecContext(ctx, "DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY created_at DESC,id DESC LIMIT 100)"); e != nil {
		return false, e
	}
	for _, id := range d.Rule.Channels {
		if e = enqueueAlert(ctx, tx, id, msg, now); e != nil {
			return false, e
		}
	}
	return true, nil
}
