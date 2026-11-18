package httpapi

import (
	"context"
	"reflect"
	"time"

	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/realtime"
)

type browserOverviewSubscription struct {
	Generation        uint64 `json:"generation"`
	TrafficGeneration uint64 `json:"traffic_generation"`
	Range             string `json:"range"`
	Timezone          string `json:"timezone"`
}

// next limits queries, while expires covers time-dependent results without a write.
type overviewFeed struct {
	dirty         bool
	next, expires time.Time
	previous      any
}

func (f overviewFeed) due(now time.Time) bool {
	return !now.Before(f.next) && (f.dirty || (!f.expires.IsZero() && !now.Before(f.expires)))
}

type browserOverview struct {
	sub            browserOverviewSubscription
	loc            *time.Location
	stats, traffic overviewFeed
}

func (o *browserOverview) reset() {
	o.stats = overviewFeed{dirty: true}
	o.traffic = overviewFeed{dirty: true}
}

func (o *browserOverview) set(s *browserOverviewSubscription) bool {
	if s == nil {
		*o = browserOverview{}
		return true
	}
	if s.Generation == 0 || s.TrafficGeneration == 0 || overviewDays[s.Range] == 0 || s.Timezone == "" || s.Timezone == "Local" || len(s.Timezone) > 255 {
		return false
	}
	if *s == o.sub {
		return true
	}
	loc, err := time.LoadLocation(s.Timezone)
	if err != nil {
		return false
	}
	if s.Generation != o.sub.Generation {
		o.stats = overviewFeed{dirty: true}
	}
	if s.TrafficGeneration != o.sub.TrafficGeneration || s.Range != o.sub.Range || s.Timezone != o.sub.Timezone {
		o.traffic = overviewFeed{dirty: true}
	}
	o.sub, o.loc = *s, loc
	return true
}

func (o *browserOverview) change(c realtime.Change) {
	switch c.Kind {
	case "nodes", "node":
		o.stats.dirty, o.traffic.dirty = true, true
	case "tasks", "engines", "metrics", "telemetry_settings", "telemetry_settings_result":
		o.stats.dirty = true
	case "history":
		if c.DailyTraffic {
			o.traffic.dirty = true
		}
	}
}

func (o *browserOverview) due(now time.Time) bool {
	return o.loc != nil && (o.stats.due(now) || o.traffic.due(now))
}

func (f *overviewFeed) publish(send func(browserFrame) bool, event string, generation uint64, data, comparable any, err error) bool {
	frame := browserFrame{Type: "event", Event: event, Generation: generation, Data: data}
	if err != nil {
		frame.Event += "_error"
		frame.Status = 503
		frame.Data = ErrorResponse{Code: "overview_unavailable", Message: "总览数据读取失败，请刷新重试"}
		f.previous = nil
	} else {
		if reflect.DeepEqual(f.previous, comparable) {
			return true
		}
		f.previous = comparable
	}
	return send(frame)
}

func (o *browserOverview) send(ctx context.Context, a *api, actor string, send func(browserFrame) bool, now time.Time, initialOnly bool) bool {
	if o.loc == nil {
		return true
	}
	if o.stats.due(now) && (!initialOnly || o.stats.next.IsZero()) {
		query, cancel := context.WithTimeout(ctx, 5*time.Second)
		data, err := a.readOverview(query, actor)
		cancel()
		o.stats.dirty, o.stats.next, o.stats.expires = false, now.Add(5*time.Second), data.NextChange
		value := data
		value.NextChange = time.Time{}
		value.Tasks.Since, value.Tasks.Until = "", ""
		if !o.stats.publish(send, "overview", o.sub.Generation, data, value, err) {
			return false
		}
	}
	if o.traffic.due(now) && (!initialOnly || o.traffic.next.IsZero()) {
		repo, ok := a.Nodes.(overviewRepository)
		o.traffic.dirty, o.traffic.next, o.traffic.expires = false, now.Add(time.Minute), time.Time{}
		if !ok {
			return o.traffic.publish(send, "overview_traffic", o.sub.TrafficGeneration, nil, nil, proxy.ErrUnavailable)
		}
		query, cancel := context.WithTimeout(ctx, 5*time.Second)
		data, err := repo.OverviewTraffic(query, overviewDays[o.sub.Range], o.loc, now)
		cancel()
		o.traffic.expires = data.NextChange
		value := data
		value.NextChange, value.End = time.Time{}, ""
		return o.traffic.publish(send, "overview_traffic", o.sub.TrafficGeneration, data, value, err)
	}
	return true
}
