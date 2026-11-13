package storage

import (
	"context"
	"math/big"
	"reflect"
	"time"

	"github.com/vioira/viorka/internal/inventory"
)

func (s *Store) Overview(ctx context.Context, actor string) (inventory.Overview, error) {
	out := inventory.Overview{Attention: []inventory.OverviewAttention{}}
	err := s.db.QueryRowContext(ctx, `SELECT count(*),coalesce(sum(state='online'),0),coalesce(sum(state='offline'),0),coalesce(sum(state='pending'),0),coalesce(sum(state='disabled'),0) FROM nodes`).Scan(&out.Nodes, &out.Online, &out.Offline, &out.Pending, &out.Disabled)
	if err != nil {
		return out, err
	}
	out.Tasks, err = s.TaskSummary(ctx)
	if err != nil {
		return out, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,name FROM nodes WHERE state='offline' ORDER BY id LIMIT 5`)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var id, name string
		if err = rows.Scan(&id, &name); err != nil {
			rows.Close()
			return out, err
		}
		out.Attention = append(out.Attention, inventory.OverviewAttention{NodeID: id, Title: name + " 离线", Detail: "节点上的服务状态待确认", Tone: "danger"})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	rows, err = s.db.QueryContext(ctx, `SELECT `+engineColumns+` FROM engines e LEFT JOIN engine_drafts d ON d.engine_id=e.id WHERE EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.disabled=0 AND (u.role='admin' OR EXISTS(SELECT 1 FROM engine_node_grants g WHERE g.user_id=u.id AND g.node_id=e.node_id))) ORDER BY e.node_id,e.id`, actor)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		e, err := scanEngine(rows)
		if err != nil {
			return out, err
		}
		count := 0
		for _, service := range e.Draft.Services {
			if !service.PendingDelete {
				count++
			}
		}
		out.Services += count
		synced := e.SyncState == "synced" && e.PublishedDraft != nil && reflect.DeepEqual(e.Draft.Services, e.PublishedDraft.Services) && reflect.DeepEqual(e.Draft.Routing, e.PublishedDraft.Routing)
		if synced {
			out.Synced += count
		} else if e.SyncState == "failed" {
			out.FailedServices += count
		} else {
			out.PendingServices += count
		}
		if !synced && count > 0 && len(out.Attention) < 10 {
			title, detail, tone := "配置待同步", "当前草稿尚未全部应用到节点", "warning"
			if e.SyncState == "failed" {
				title, detail, tone = "配置同步失败", "请进入节点查看同步状态并重试", "danger"
			}
			if e.SyncState == "syncing" {
				title, detail = "配置同步中", "等待 Agent 执行结果"
			}
			out.Attention = append(out.Attention, inventory.OverviewAttention{NodeID: e.NodeID, Title: e.Name + " " + title, Detail: detail, Tone: tone})
		}
	}
	return out, rows.Err()
}

// Daily records remain indivisible: group by their start date in the requested
// timezone, never prorate a daily counter into fabricated hourly measurements.
func (s *Store) OverviewTraffic(ctx context.Context, days int, loc *time.Location, now time.Time) (inventory.OverviewTraffic, error) {
	local := now.In(loc)
	end := time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, loc)
	start := end.AddDate(0, 0, -days)
	out := inventory.OverviewTraffic{Start: start.UTC().Format(time.RFC3339), End: now.UTC().Format(time.RFC3339), Timezone: loc.String(), Points: make([]inventory.OverviewTrafficPoint, days)}
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM nodes WHERE state IN ('online','offline')`).Scan(&out.ExpectedNodes); err != nil {
		return out, err
	}
	type bucket struct {
		rx, tx big.Int
		nodes  map[string]bool
	}
	buckets := make([]bucket, days)
	dates := map[string]int{}
	for i := range out.Points {
		date := start.AddDate(0, 0, i).Format("2006-01-02")
		out.Points[i].Date = date
		dates[date] = i
		buckets[i].nodes = map[string]bool{}
	}
	rows, err := s.db.QueryContext(ctx, `SELECT d.node_id,d.day_start,d.day_end,d.rx_bytes,d.tx_bytes,d.sampled_at,d.quality FROM node_daily_traffic d JOIN nodes n ON n.id=d.node_id WHERE n.state IN ('online','offline') AND d.day_start>=? AND d.day_start<=? ORDER BY d.day_start,d.node_id`, start.UnixMilli(), now.UnixMilli())
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var node string
		var at, endAt, rx, tx, sampled, quality int64
		if err = rows.Scan(&node, &at, &endAt, &rx, &tx, &sampled, &quality); err != nil {
			return out, err
		}
		i := dates[time.UnixMilli(at).In(loc).Format("2006-01-02")]
		b := &buckets[i]
		p := &out.Points[i]
		b.rx.Add(&b.rx, big.NewInt(rx))
		b.tx.Add(&b.tx, big.NewInt(tx))
		b.nodes[node] = true
		p.Partial = p.Partial || quality != 0 || (endAt <= now.UnixMilli() && sampled < endAt) || (endAt > now.UnixMilli() && now.Sub(time.UnixMilli(sampled)) > 5*time.Minute)
		stamp := time.UnixMilli(sampled).UTC().Format(time.RFC3339Nano)
		if stamp > p.SampledAt {
			p.SampledAt = stamp
		}
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	var rx, tx big.Int
	any := false
	for i := range out.Points {
		p := &out.Points[i]
		b := &buckets[i]
		p.ReportingNodes = len(b.nodes)
		p.Partial = p.Partial || p.ReportingNodes < out.ExpectedNodes
		out.Partial = out.Partial || p.Partial
		if p.ReportingNodes > 0 {
			a, c := b.rx.String(), b.tx.String()
			p.RX, p.TX = &a, &c
			rx.Add(&rx, &b.rx)
			tx.Add(&tx, &b.tx)
			any = true
		}
	}
	if any {
		a, b := rx.String(), tx.String()
		out.RX, out.TX = &a, &b
	}
	return out, nil
}
