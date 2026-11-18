package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"time"

	"github.com/vioira/viorka/internal/realtime"
	"github.com/vioira/viorka/internal/scheduler"
)

// Each key names one read-only projection on the layout's existing connection.
type browserView struct {
	Generation uint64 `json:"generation"`
	Node       string `json:"node,omitempty"`
	Range      string `json:"range,omitempty"`
	State      string `json:"state,omitempty"`
	After      string `json:"after,omitempty"`
}

type activeBrowserView struct {
	browserView
	dirty         bool
	next, expires time.Time
	previous      []byte
	summary       *scheduler.Summary
	minutes       map[int64]HistoryPoint
}

type browserViews map[string]*activeBrowserView

func (views browserViews) set(next map[string]browserView) bool {
	if len(next) > 4 {
		return false
	}
	for key, v := range next {
		if v.Generation == 0 {
			return false
		}
		switch key {
		case "task_page":
			if v.Node != "" || v.Range != "" || (v.After != "" && !browserID.MatchString(v.After)) {
				return false
			}
			switch v.State {
			case "all", "queued", "succeeded", "failed":
			default:
				return false
			}
		case "task_summary":
			if v.Node != "" || v.Range != "" || v.State != "" || v.After != "" {
				return false
			}
		case "minute_history", "metric_trends":
			if !browserID.MatchString(v.Node) || v.State != "" || v.After != "" {
				return false
			}
			if key == "minute_history" {
				if v.Range != "10m" {
					return false
				}
			} else {
				switch v.Range {
				case "1h", "6h", "24h", "2d", "7d":
				default:
					return false
				}
			}
		default:
			return false
		}
		if old := views[key]; old == nil || old.browserView != v {
			views[key] = &activeBrowserView{browserView: v, dirty: true}
		}
	}
	for k := range views {
		if _, ok := next[k]; !ok {
			delete(views, k)
		}
	}
	return true
}

func (views browserViews) reset() {
	for _, v := range views {
		*v = activeBrowserView{browserView: v.browserView, dirty: true}
	}
}
func (views browserViews) change(c realtime.Change) {
	for k, v := range views {
		switch k {
		case "task_page":
			if c.Kind == "tasks" || c.NodeRenamed {
				v.dirty = true
			}
		case "task_summary":
			if c.Kind == "tasks" {
				v.dirty = true
			}
		default:
			if (c.Kind == "history" && !c.DailyTraffic || c.Kind == "nodes") && (c.NodeID == v.Node || c.NodeID == "") {
				v.dirty = true
			}
		}
	}
}
func (v *activeBrowserView) due(now time.Time) bool {
	return !now.Before(v.next) && (v.dirty || !v.expires.IsZero() && !now.Before(v.expires))
}
func (views browserViews) due(now time.Time) bool {
	for _, v := range views {
		if v.due(now) {
			return true
		}
	}
	return false
}
func (views browserViews) send(a *api, r *http.Request, csrf string, commands map[string]browserCommand, send func(browserFrame) bool, now time.Time, initialOnly bool) bool {
	for k, v := range views {
		if !v.due(now) || initialOnly && !v.next.IsZero() {
			continue
		}
		checkOpenBucket := v.dirty
		v.dirty = false
		v.expires = time.Time{}
		interval := time.Second
		method := ""
		params := browserParams{ID: v.Node}
		switch k {
		case "task_page":
			method = "listTasks"
			params.Query = map[string]string{"state": v.State, "after": v.After, "limit": "50"}
		case "task_summary":
			if !v.sendSummary(r.Context(), a.Tasks, send, now) {
				return false
			}
			continue
		case "minute_history":
			method = "nodeMetricHistory"
			interval = time.Minute
			params.Query = map[string]string{"range": "10m", "period_seconds": "60"}
		case "metric_trends":
			method = "nodeMetricTrends"
			interval = 30 * time.Second
			params.Query = map[string]string{"range": v.Range}
		}
		result := executeBrowserCommand(r, csrf, commands[method], browserMessage{Params: params})
		v.next = now.Add(interval)
		frame := browserFrame{Type: "event", Event: k, Generation: v.Generation, Status: result.Status, Data: result.Data}
		if result.Status != 200 {
			frame.Event += "_error"
			v.minutes = nil
			v.previous = nil
		} else {
			raw := result.Data.(json.RawMessage)
			// A write can land in the still-open bucket, outside the current projection.
			switch k {
			case "minute_history":
				var h HistoryResponse
				if err := json.Unmarshal(raw, &h); err != nil {
					return false
				}
				if checkOpenBucket || len(h.Points) > 0 {
					v.expires = now.Truncate(time.Minute).Add(time.Minute)
				}
				delta := v.minuteDelta(h)
				if !delta.Reset && len(delta.Points) == 0 && len(delta.Removed) == 0 {
					continue
				}
				frame.Data = delta
				if !send(frame) {
					return false
				}
				continue
			case "metric_trends":
				var h MetricTrendHistory
				if err := json.Unmarshal(raw, &h); err != nil {
					return false
				}
				if checkOpenBucket || hasTrendSamples(h) {
					v.expires = h.End.Add(time.Duration(h.Charts["cpu"].PeriodSeconds) * time.Second)
				}
			}
			if bytes.Equal(raw, v.previous) {
				continue
			}
			v.previous = raw
		}
		if !send(frame) {
			return false
		}
	}
	return true
}

type minuteHistoryDelta struct {
	HistoryResponse
	Reset   bool    `json:"reset"`
	Removed []int64 `json:"removed"`
}

func (v *activeBrowserView) minuteDelta(h HistoryResponse) minuteHistoryDelta {
	delta := minuteHistoryDelta{HistoryResponse: HistoryResponse{PeriodSeconds: h.PeriodSeconds, Points: []HistoryPoint{}}, Reset: v.minutes == nil, Removed: []int64{}}
	current := make(map[int64]HistoryPoint, len(h.Points))
	for _, p := range h.Points {
		current[p.Start] = p
		if old, ok := v.minutes[p.Start]; !ok || !reflect.DeepEqual(old, p) {
			delta.Points = append(delta.Points, p)
		}
	}
	for start := range v.minutes {
		if _, ok := current[start]; !ok {
			delta.Removed = append(delta.Removed, start)
		}
	}
	v.minutes = current
	return delta
}

func hasTrendSamples(h MetricTrendHistory) bool {
	for _, c := range h.Charts {
		for _, p := range c.Points {
			for _, value := range p.Values {
				if value != nil {
					return true
				}
			}
		}
	}
	return false
}

func (v *activeBrowserView) sendSummary(ctx context.Context, tasks *scheduler.Service, send func(browserFrame) bool, now time.Time) bool {
	v.next = now.Add(5 * time.Second)
	frame := browserFrame{Type: "event", Event: "task_summary_error", Generation: v.Generation, Status: 503, Data: ErrorResponse{Code: "summary_unavailable", Message: "任务统计读取失败，请刷新重试"}}
	if tasks == nil {
		v.summary = nil
		return send(frame)
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	value, err := tasks.Summary(ctx)
	if err != nil {
		v.summary = nil
		return send(frame)
	}
	frame.Event, frame.Status, frame.Data = "task_summary", 200, value
	v.expires = value.NextChange
	value.Since, value.Until, value.NextChange = "", "", time.Time{}
	if reflect.DeepEqual(v.summary, &value) {
		return true
	}
	v.summary = &value
	return send(frame)
}

func sendRecoveryChange(r *http.Request, csrf string, command browserCommand, wanted []browserChangeSubscription, c realtime.Change, role string, send func(browserFrame) bool) bool {
	c.Kind = "recovery"
	if (role != "admin" && role != "operator") || !matchesBrowserChange(wanted, c) {
		return true
	}
	update := ResourceChange{Change: c}
	if c.EngineID != "" {
		result := executeBrowserCommand(r, csrf, command, browserMessage{Params: browserParams{ID: c.EngineID}})
		switch result.Status {
		case 200:
			update.Recovery = result.Data.(json.RawMessage)
		case 403, 404:
			return true
		default:
			return send(browserFrame{Type: "event", Event: "recovery_error", Data: ErrorResponse{Code: "recovery_unavailable", Message: "恢复核对状态读取失败，请刷新重试"}})
		}
	}
	return send(browserFrame{Type: "event", Event: "change", Data: update})
}
