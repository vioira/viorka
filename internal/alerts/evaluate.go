// Package alerts evaluates notification rules against authenticated observations.
package alerts

import (
	"math"
	"math/big"
	"slices"
	"sort"
	"strconv"
	"time"

	v1 "github.com/vioira/viorka/protocol/v1"
)

type Decision struct {
	Rule         Rule
	At           time.Time
	Value        float64
	High, Normal bool
	Period       int64
}
type point struct {
	at    int64
	value float64
}
type series struct {
	points []point
	last   int64
	source string
}

// Windows are scoped to a node and its current run. Series are shared by rules
// on the same metric, retain at most one hour and never use history chart buckets.
type Windows struct {
	monthlyMS int64
	Run       string
	Values    map[string]*series
	latest    map[string]Reading
}

type Reading struct {
	State                      string
	SampleMS, ExpiresMS, Since int64
}

// A candidate shares immutable samples. Appends only extend a retained slice;
// publishing the new series headers waits for the enclosing transaction.
func (w *Windows) Candidate() Windows {
	next := Windows{monthlyMS: w.monthlyMS, Run: w.Run, Values: make(map[string]*series, len(w.Values)), latest: map[string]Reading{}}
	for k, v := range w.Values {
		copy := *v
		next.Values[k] = &copy
	}
	return next
}
func (w *Windows) Readings() map[string]Reading { return w.latest }
func (w *Windows) Evaluate(rules []Rule, b v1.TelemetryBatch, c v1.TelemetrySettings, http bool, floor [3]uint64, now time.Time) []Decision {
	if w.Run != b.RunID || w.Values == nil {
		w.Run = b.RunID
		w.monthlyMS = 0
		w.Values = map[string]*series{}
	}
	byMetric := map[string][]Rule{}
	for _, r := range rules {
		if r.Metric != "offline" && r.Applies(b.NodeID) {
			byMetric[r.Metric] = append(byMetric[r.Metric], r)
		}
	}
	for key := range w.Values {
		if len(byMetric[key]) == 0 {
			delete(w.Values, key)
		}
	}
	w.latest = map[string]Reading{}
	record := func(r Rule, at time.Time, state string) {
		w.latest[r.ID] = Reading{state, at.UnixMilli(), at.Add(time.Duration(c.HttpReportSeconds+5) * time.Second).UnixMilli(), r.Since}
	}
	var out []Decision
	observe := func(metric string, at time.Time, val float64, cadence uint64, source string) {
		rs := byMetric[metric]
		if len(rs) == 0 {
			return
		}
		s := w.Values[metric]
		if s == nil {
			s = &series{}
			w.Values[metric] = s
		}
		ms := at.UnixMilli()
		if ms <= s.last || at.After(now.Add(time.Second)) {
			return
		}
		if s.source != source || ms-s.last > int64(cadence)*1500+1000 || math.IsNaN(val) {
			s.points = nil
		}
		s.last = ms
		s.source = source
		for _, r := range rs {
			record(r, at, "insufficient")
		}
		if math.IsNaN(val) {
			return
		}
		s.points = append(s.points, point{ms, val})
		maxMinutes := 0
		for _, r := range rs {
			maxMinutes = max(maxMinutes, r.WindowMinutes)
		}
		cut := ms - int64(maxMinutes)*60000
		first := sort.Search(len(s.points), func(i int) bool { return s.points[i].at >= cut })
		if first > 1 {
			s.points = s.points[first-1:]
		}
		if len(s.points) > 3602 {
			s.points = s.points[len(s.points)-3602:]
		}
		if at.After(now.Add(time.Second)) || now.Sub(at) > time.Duration(c.HttpReportSeconds+5)*time.Second {
			return
		}
		for _, r := range rs {
			start := ms - int64(r.WindowMinutes)*60000
			if start < r.Since || s.points[0].at > start {
				continue
			}
			i := sort.Search(len(s.points), func(i int) bool { return s.points[i].at >= start })
			points := s.points[i:]
			if len(points) < 2 {
				continue
			}
			low, high, sum := points[0].value, points[0].value, 0.0
			for _, p := range points {
				low = min(low, p.value)
				high = max(high, p.value)
				sum += p.value
			}
			v := sum / float64(len(points))
			d := Decision{Rule: r, At: at, Value: v, High: v > r.Threshold, Normal: v <= r.Threshold}
			if r.Mode == "all" {
				d.High = low > r.Threshold
				d.Normal = high <= r.Threshold
				d.Value = low
				if d.Normal {
					d.Value = high
				}
			}
			state := "mixed"
			if d.High {
				state = "high"
			} else if d.Normal {
				state = "normal"
			}
			record(r, at, state)
			if d.High || d.Normal {
				out = append(out, d)
			}
		}
	}
	fastCadence := c.CollectionSeconds
	if !http {
		fastCadence = c.WssReportSeconds
	}
	traffic := c.TrafficSettings()
	for _, f := range b.Fast {
		if f.Sequence <= floor[0] {
			continue
		}
		cpu, mem := math.NaN(), math.NaN()
		if f.CPUPercent != nil && !slices.Contains(f.Errors, "cpu_unavailable") {
			cpu = *f.CPUPercent
		}
		if f.RamTotal != nil && *f.RamTotal > 0 && f.RamUsed != nil && !slices.Contains(f.Errors, "memory_unavailable") {
			mem = float64(*f.RamUsed) / float64(*f.RamTotal) * 100
		}
		rx, tx := networkRates(f)
		if slices.Contains(f.Errors, "unsupported_platform") {
			cpu = math.NaN()
			mem = math.NaN()
			rx = math.NaN()
			tx = math.NaN()
		}
		observe("cpu", f.SampledAt, cpu, fastCadence, "")
		observe("memory", f.SampledAt, mem, fastCadence, "")
		observe("upload", f.SampledAt, tx, fastCadence, f.FilterRevision)
		observe("download", f.SampledAt, rx, fastCadence, f.FilterRevision)
		if f.SampledAt.After(now.Add(time.Second)) || now.Sub(f.SampledAt) > time.Duration(c.HttpReportSeconds+5)*time.Second {
			continue
		}
		if f.SampledAt.UnixMilli() <= w.monthlyMS {
			continue
		}
		w.monthlyMS = f.SampledAt.UnixMilli()
		for _, r := range byMetric["monthly"] {
			if f.SampledAt.UnixMilli() < r.Since {
				continue
			}
			if r.Mode == "percent" && traffic.QuotaBytes == "0" {
				record(r, f.SampledAt, "no_quota")
				continue
			}
			record(r, f.SampledAt, "insufficient")
			if d, ok := monthly(r, f, &traffic, now); ok {
				state := "normal"
				if d.High {
					state = "high"
				}
				record(r, f.SampledAt, state)
				out = append(out, d)
			}
		}
	}
	for _, f := range b.Full {
		if f.Sequence <= floor[1] {
			continue
		}
		v := math.NaN()
		if f.DiskUsed != nil && f.DiskAvailable != nil && !slices.Contains(f.Errors, "unsupported_platform") && !slices.Contains(f.Errors, "disk_unavailable") {
			used := float64(*f.DiskUsed)
			total := used + float64(*f.DiskAvailable)
			if total > 0 {
				v = 100 * used / total
			}
		}
		observe("disk", f.SampledAt, v, c.HttpReportSeconds, "")
	}
	return out
}
func networkRates(f *v1.TelemetryFast) (float64, float64) {
	if len(f.Interfaces) == 0 || slices.Contains(f.Errors, "network_unavailable") {
		return math.NaN(), math.NaN()
	}
	var rx, tx float64
	for _, i := range f.Interfaces {
		if i == nil || slices.Contains(i.Quality, "partial") || slices.Contains(i.Quality, "unknown") {
			return math.NaN(), math.NaN()
		}
		if i.RXBytesPerSecond == nil {
			rx = math.NaN()
		} else {
			rx += *i.RXBytesPerSecond
		}
		if i.TXBytesPerSecond == nil {
			tx = math.NaN()
		} else {
			tx += *i.TXBytesPerSecond
		}
	}
	return rx / 1e6, tx / 1e6
}
func monthly(r Rule, f *v1.TelemetryFast, c *v1.TelemetryTrafficSettings, now time.Time) (Decision, bool) {
	t := f.Traffic
	if c == nil || t == nil || slices.Contains(f.Errors, "traffic_unavailable") || slices.Contains(f.Errors, "unsupported_platform") || slices.Contains(t.Quality, "unknown") || slices.Contains(t.Quality, "persist_failed") || (!t.PeriodEnd.IsZero() && !now.Before(t.PeriodEnd)) {
		return Decision{}, false
	}
	used := new(big.Int)
	if c.BillingMode != "outbound" {
		if t.RXBytes == nil {
			return Decision{}, false
		}
		used.SetUint64(*t.RXBytes)
	}
	if c.BillingMode != "inbound" {
		if t.TXBytes == nil {
			return Decision{}, false
		}
		used.Add(used, new(big.Int).SetUint64(*t.TXBytes))
	}
	denominator := big.NewInt(1000000000)
	if r.Mode == "percent" {
		quota, ok := new(big.Int).SetString(c.QuotaBytes, 10)
		if !ok || quota.Sign() <= 0 {
			return Decision{}, false
		}
		denominator = quota
		used.Mul(used, big.NewInt(100))
	}
	amount := new(big.Rat).SetFrac(used, denominator)
	threshold, _ := new(big.Rat).SetString(strconv.FormatFloat(r.Threshold, 'f', -1, 64))
	high := amount.Cmp(threshold) >= 0
	// An incomplete ledger can already exceed an allowance. Its smaller
	// total cannot establish recovery until the Agent reports a usable ledger.
	if !high && (slices.Contains(t.Quality, "partial") || slices.Contains(t.Quality, "period_gap") || slices.Contains(t.Quality, "mixed_filter")) {
		return Decision{}, false
	}
	v, _ := amount.Float64()
	return Decision{Rule: r, At: f.SampledAt, Value: v, High: high, Normal: !high, Period: t.MonthStart.UnixMilli()}, true
}
