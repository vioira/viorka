package monitoring

import (
	"math/big"
	"sort"
	"strconv"
	"time"
)

const MetricTrendLimit = 120

type MetricTrendPoint struct {
	ID      string              `json:"id"`
	At      time.Time           `json:"at"`
	Source  string              `json:"source" enum:"history,live"`
	Values  map[string]*float64 `json:"values"`
	Partial bool                `json:"partial,omitempty"`
	Gap     bool                `json:"-"`
}

type MetricTrendDelta struct {
	Reset         bool               `json:"reset"`
	PeriodSeconds int                `json:"period_seconds"`
	Statistic     string             `json:"statistic" enum:"mean,peak,latest"`
	Points        []MetricTrendPoint `json:"points" maxItems:"120"`
	RemovedIDs    []string           `json:"removed_ids" maxItems:"120"`
}

type MetricTrends map[string]MetricTrendDelta

type trendSpec struct {
	key, group, statistic string
	keys, rawKeys         []string
}

var trendSpecs = []trendSpec{
	{"cpu", "fast", "mean", []string{"cpu"}, []string{"cpu_percent"}},
	{"memory", "fast", "mean", []string{"memory", "swap"}, []string{"memory_percent", "swap_percent"}},
	{"network", "fast", "peak", []string{"rx", "tx"}, []string{"rx_bytes_per_second", "tx_bytes_per_second"}},
	{"connections", "fast", "peak", []string{"tcp_sockets", "udp_sockets"}, []string{"tcp_inuse", "udp_inuse"}},
	{"load", "full", "latest", []string{"load_one", "load_five", "load_fifteen"}, []string{"load_1", "load_5", "load_15"}},
	{"disk", "full", "latest", []string{"disk"}, []string{"disk_percent"}},
	{"disk_io", "full", "peak", []string{"disk_read", "disk_write"}, []string{"disk_read", "disk_write"}},
	{"processes", "full", "peak", []string{"processes"}, []string{"processes"}},
}

type metricTrendWindow struct {
	spec   trendSpec
	period int
	points []MetricTrendPoint
}

// Each chart has an independent window: fast observations never evict slow samples.
type MetricTrendWindows struct {
	windows   []metricTrendWindow
	StartedAt time.Time
}

func meanPercent(mean Mean, total *uint64) *float64 {
	value := mean.Average()
	if value == nil || total == nil || *total == 0 {
		return nil
	}
	return ptr(*value / float64(*total) * 100)
}

func bucketTrendValues(b Bucket) map[string]*float64 {
	var disk *float64
	if b.DiskUsed != nil && b.DiskAvailable != nil {
		used := new(big.Int).SetUint64(*b.DiskUsed)
		total := new(big.Int).Add(used, new(big.Int).SetUint64(*b.DiskAvailable))
		if total.Sign() > 0 {
			q, r := new(big.Int).QuoRem(new(big.Int).Mul(used, big.NewInt(100)), total, new(big.Int))
			if r.Sign() > 0 {
				q.Add(q, big.NewInt(1))
			}
			disk = ptr(float64(q.Uint64()))
		}
	}
	return map[string]*float64{
		"cpu": b.CPU.Average(), "memory": meanPercent(b.RAMUsed, b.RAMTotal), "swap": meanPercent(b.SwapUsed, b.SwapTotal),
		"rx": b.NetInSpeed.Max, "tx": b.NetOutSpeed.Max, "tcp_sockets": b.TCPCount.Max, "udp_sockets": b.UDPCount.Max,
		"load_one": b.Load1, "load_five": b.Load5, "load_fifteen": b.Load15, "disk": disk,
		"disk_read": b.DiskIO.ReadSpeed.Max, "disk_write": b.DiskIO.WriteSpeed.Max, "processes": b.ProcessCount.Max,
	}
}

// History is already aggregated by the store. Full-group charts use at least
// 180-second buckets; sufficient statistics retain their original semantics.
func NewMetricTrendWindows(history History, start, end time.Time) (*MetricTrendWindows, MetricTrends) {
	windows := &MetricTrendWindows{StartedAt: end}
	for _, spec := range trendSpecs {
		period := history.PeriodSeconds
		if spec.group == "full" {
			period = max(period, 180)
		}
		buckets := map[int64]Bucket{}
		for _, b := range history.Points {
			at := b.Start / int64(period) * int64(period)
			merged := buckets[at]
			merged.Start = at
			merged.Merge(b)
			buckets[at] = merged
		}
		w := metricTrendWindow{spec: spec, period: period}
		stop := time.Unix(end.Unix()/int64(period)*int64(period), 0).UTC()
		begin := time.Unix(start.Unix()/int64(period)*int64(period), 0).UTC()
		if stop.Sub(begin) > time.Duration(MetricTrendLimit*period)*time.Second {
			begin = stop.Add(-time.Duration(MetricTrendLimit*period) * time.Second)
		}
		for at := begin; at.Before(stop); at = at.Add(time.Duration(period) * time.Second) {
			b := buckets[at.Unix()]
			values := bucketTrendValues(b)
			p := MetricTrendPoint{ID: "h:" + strconv.FormatInt(at.Unix(), 10), At: at, Source: "history", Values: map[string]*float64{}}
			for _, key := range spec.keys {
				p.Values[key] = values[key]
			}
			p.Partial = spec.key == "disk_io" && b.DiskIO.Quality != 0
			w.points = append(w.points, p)
		}
		windows.windows = append(windows.windows, w)
	}
	return windows, windows.Snapshot()
}

func (w *metricTrendWindow) delta(reset bool) MetricTrendDelta {
	return MetricTrendDelta{Reset: reset, PeriodSeconds: w.period, Statistic: w.spec.statistic, Points: []MetricTrendPoint{}, RemovedIDs: []string{}}
}
func (n *MetricTrendWindows) Snapshot() MetricTrends {
	out := MetricTrends{}
	for _, w := range n.windows {
		d := w.delta(true)
		d.Points = append(d.Points, w.points...)
		out[w.spec.key] = d
	}
	return out
}
func (n *MetricTrendWindows) Update(points []TelemetryLivePoint, now time.Time) MetricTrends {
	out := MetricTrends{}
	for i := range n.windows {
		w := &n.windows[i]
		out[w.spec.key] = w.update(points, now)
	}
	return out
}
func (w *metricTrendWindow) update(points []TelemetryLivePoint, now time.Time) MetricTrendDelta {
	old := map[string]bool{}
	for _, p := range w.points {
		old[p.ID] = true
	}
	replaced := map[int64]bool{}
	for _, p := range points {
		if p.Group == w.spec.group {
			replaced[p.At.Unix()/int64(w.period)] = true
		}
	}
	next := make([]MetricTrendPoint, 0, len(w.points)+len(points))
	for _, p := range w.points {
		if p.At.After(now.Add(-LiveWindow)) && !(p.Source == "history" && replaced[p.At.Unix()/int64(w.period)]) {
			next = append(next, p)
		}
	}
	for _, p := range points {
		if p.Group != w.spec.group || !p.At.After(now.Add(-LiveWindow)) {
			continue
		}
		id := "l:" + strconv.FormatUint(p.Sequence, 10)
		if old[id] {
			continue
		}
		sample := MetricTrendPoint{ID: id, At: p.At, Source: "live", Values: map[string]*float64{}, Partial: w.spec.key == "disk_io" && p.Values["disk_io_partial"] == 1}
		for i, key := range w.spec.keys {
			sample.Values[key] = nil
			if v, ok := p.Values[w.spec.rawKeys[i]]; ok {
				sample.Values[key] = ptr(v)
			}
		}
		next = append(next, sample)
	}
	sort.SliceStable(next, func(i, j int) bool { return next[i].At.Before(next[j].At) })
	// Mark interruptions explicitly so the renderer never connects across an outage.
	continuous := make([]MetricTrendPoint, 0, len(next))
	gap := 30 * time.Second
	if w.spec.group == "full" {
		gap = 180 * time.Second
	}
	for _, p := range next {
		if len(continuous) > 0 {
			previous := continuous[len(continuous)-1]
			allowance := gap
			if previous.Source == "history" {
				allowance += time.Duration(w.period) * time.Second
			}
			if !previous.Gap && p.At.Sub(previous.At) > allowance {
				at := previous.At.Add(gap)
				values := map[string]*float64{}
				for _, key := range w.spec.keys {
					values[key] = nil
				}
				continuous = append(continuous, MetricTrendPoint{ID: "g:" + p.ID, At: at, Source: "live", Values: values, Gap: true})
			}
		}
		continuous = append(continuous, p)
	}
	if len(continuous) > MetricTrendLimit {
		continuous = continuous[len(continuous)-MetricTrendLimit:]
	}
	delta := w.delta(false)
	retained := map[string]bool{}
	for _, p := range continuous {
		retained[p.ID] = true
		if !old[p.ID] {
			delta.Points = append(delta.Points, p)
		}
	}
	for _, p := range w.points {
		if !retained[p.ID] {
			delta.RemovedIDs = append(delta.RemovedIDs, p.ID)
		}
	}
	w.points = continuous
	return delta
}
