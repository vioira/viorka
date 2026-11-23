package storage

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/vioira/viorka/internal/alerts"
	"github.com/vioira/viorka/internal/auth"
)

func enqueueAlert(ctx context.Context, tx *sql.Tx, id string, m alerts.Message, when time.Time) error {
	var has bool
	var queued, position int
	if e := tx.QueryRowContext(ctx, `SELECT c.secret_encrypted!='',count(d.id),coalesce(max(d.position),0)+1 FROM alert_channels c LEFT JOIN alert_deliveries d ON d.channel_id=c.id WHERE c.id=? GROUP BY c.id,c.secret_encrypted`, id).Scan(&has, &queued, &position); e != nil {
		return e
	}
	if !has || queued >= 1000 {
		detail := "待投递队列已满"
		if !has {
			detail = "请重新填写渠道凭证"
		}
		_, e := tx.ExecContext(ctx, "UPDATE alert_channels SET last_state='failed',last_at=?,last_detail=? WHERE id=?", at(when), detail, id)
		return e
	}
	_, e := tx.ExecContext(ctx, "INSERT INTO alert_deliveries(id,channel_id,title,body,due_ms,created_ms,position) VALUES(?,?,?,?,?,?,?)", auth.Random(), id, m.Title, m.Body, when.UnixMilli(), when.UnixMilli(), position)
	if e != nil {
		return e
	}
	_, e = tx.ExecContext(ctx, "UPDATE alert_channels SET last_state='queued',last_at=?,last_detail='' WHERE id=?", at(when), id)
	return e
}
func (s *Store) TestAlertChannel(ctx context.Context, id, actor string) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var has bool
	var count int
	if e = tx.QueryRowContext(ctx, "SELECT secret_encrypted!='',(SELECT count(*) FROM alert_deliveries WHERE channel_id=?) FROM alert_channels WHERE id=?", id, id).Scan(&has, &count); errors.Is(e, sql.ErrNoRows) {
		return auth.ErrNotFound
	} else if e != nil {
		return e
	}
	if !has || count >= 1000 {
		return auth.ErrConflict
	}
	if e = enqueueAlert(ctx, tx, id, alerts.Message{Title: "Viorka 测试通知", Body: "此消息用于验证所选通知渠道。"}, time.Now()); e != nil {
		return e
	}
	if e = audit(ctx, tx, actor, "notifications.test", "notification_channel", id); e != nil {
		return e
	}
	return tx.Commit()
}

type alertJob struct {
	id      string
	ch      alerts.Channel
	secret  string
	msg     alerts.Message
	attempt int
}

func (s *Store) claimAlertJob(ctx context.Context) (alertJob, error) {
	var j alertJob
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return j, e
	}
	defer tx.Rollback()
	var enc string
	e = tx.QueryRowContext(ctx, `SELECT d.id,d.channel_id,d.title,d.body,d.attempts,c.secret_encrypted FROM alert_deliveries d JOIN alert_channels c ON c.id=d.channel_id WHERE d.due_ms<=? AND NOT EXISTS(SELECT 1 FROM alert_deliveries prior WHERE prior.channel_id=d.channel_id AND prior.position<d.position) ORDER BY d.due_ms,d.created_ms,d.id LIMIT 1`, time.Now().UnixMilli()).Scan(&j.id, &j.ch.ID, &j.msg.Title, &j.msg.Body, &j.attempt, &enc)
	if e != nil {
		return j, e
	}
	cfg, e := readAlertConfig(ctx, tx)
	if e != nil {
		return j, e
	}
	for _, ch := range cfg.Channels {
		if ch.ID == j.ch.ID {
			j.ch = ch
			break
		}
	}
	secret, decryptErr := s.openEngine("notification/"+j.ch.ID, enc)
	if decryptErr == nil {
		j.secret = string(secret)
	}
	j.attempt++
	_, e = tx.ExecContext(ctx, "UPDATE alert_deliveries SET attempts=?,due_ms=? WHERE id=?", j.attempt, time.Now().Add(time.Minute).UnixMilli(), j.id)
	if e != nil {
		return j, e
	}
	return j, tx.Commit()
}
func (s *Store) completeAlertJob(ctx context.Context, j alertJob, result alerts.SendResult) error {
	tx, e := s.db.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	now := time.Now()
	state := "failed"
	var res sql.Result
	if result.Retry && j.attempt < 5 {
		state = "retry"
		wait := max(result.Delay, time.Duration(1<<j.attempt)*5*time.Second)
		res, e = tx.ExecContext(ctx, "UPDATE alert_deliveries SET due_ms=? WHERE id=? AND attempts=?", now.Add(wait).UnixMilli(), j.id, j.attempt)
	} else {
		if result.Accepted {
			state = "accepted"
		}
		res, e = tx.ExecContext(ctx, "DELETE FROM alert_deliveries WHERE id=? AND attempts=?", j.id, j.attempt)
	}
	if e != nil {
		return e
	}
	n, e := res.RowsAffected()
	if e != nil || n == 0 {
		return e
	}
	if _, e = tx.ExecContext(ctx, "UPDATE alert_channels SET last_state=?,last_at=?,last_detail=? WHERE id=?", state, at(now), result.Detail, j.ch.ID); e != nil {
		return e
	}
	return tx.Commit()
}
func (s *Store) RunAlertDelivery(ctx context.Context) { s.runAlertDelivery(ctx, alerts.Client) }

func (s *Store) runAlertDelivery(ctx context.Context, client *http.Client) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		work, stop := context.WithTimeout(ctx, 12*time.Second)
		j, e := s.claimAlertJob(work)
		if e == nil {
			result := alerts.SendResult{Detail: "渠道凭证不可用，请重新填写"}
			if j.attempt > 5 {
				result.Detail = "已达到投递尝试上限"
			} else if j.secret != "" {
				result = alerts.Send(work, client, j.ch, j.secret, j.msg)
			}
			e = s.completeAlertJob(work, j, result)
		}
		stop()
		wait := time.Second
		if e == nil {
			wait = 0
		} else if !errors.Is(e, sql.ErrNoRows) && ctx.Err() == nil {
			slog.Error("notification delivery storage unavailable")
			wait = 5 * time.Second
		}
		timer.Reset(wait)
	}
}
