// Package monitoring keeps bounded, ephemeral host monitoring snapshots.
package monitoring

import (
	"encoding/json"
	"fmt"
	v1 "github.com/vioira/viorka/protocol/v1"
	"math"
	"slices"
	"sync"
	"time"
)

const MaxNodes = 1024
const MaxHistory = 60

type Point struct {
	At     time.Time `json:"at"`
	CPU    *float64  `json:"cpu,omitempty"`
	Memory *float64  `json:"memory,omitempty"`
	RX     *float64  `json:"rx,omitempty"`
	TX     *float64  `json:"tx,omitempty"`
}
type Snapshot struct {
	ReportIntervalSeconds uint64          `json:"report_interval_seconds,omitempty"`
	Latest                *v1.NodeMetrics `json:"latest,omitempty"`
	ReceivedAt            time.Time       `json:"received_at"`
	Stale                 bool            `json:"stale"`
	History               []Point         `json:"history"`
}
type entry struct {
	reportInterval uint64
	latest         *v1.NodeMetrics
	received       time.Time
	history        []Point
}
type Store struct {
	mu      sync.Mutex
	entries map[string]entry
}

func New() *Store { return &Store{entries: map[string]entry{}} }

// Decode enforces required fields as well as finite values, sizes and relationships.
// Absent groups mean unknown; zero is only accepted inside a reported group.
func Decode(b []byte, now time.Time) (v1.NodeMetrics, error) {
	var m v1.NodeMetrics
	if err := v1.Decode(b, &m); err != nil {
		return m, err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		return m, err
	}
	required := func(data json.RawMessage, keys ...string) bool {
		var obj map[string]json.RawMessage
		if json.Unmarshal(data, &obj) != nil {
			return false
		}
		for _, k := range keys {
			v, ok := obj[k]
			if !ok || string(v) == "null" {
				return false
			}
		}
		return true
	}
	if !required(b, "sampled_at", "interval_seconds", "errors", "interfaces") || m.SampledAt.IsZero() || m.SampledAt.Before(now.Add(-5*time.Minute)) || m.SampledAt.After(now.Add(5*time.Minute)) || !bounded(m.IntervalSeconds, 600) || len(m.Interfaces) > 64 || len(m.Errors) > 8 {
		return m, fmt.Errorf("invalid metrics envelope")
	}
	seen := map[string]bool{}
	for _, e := range m.Errors {
		switch e {
		case "cpu_unavailable", "memory_unavailable", "load_unavailable", "disk_unavailable", "uptime_unavailable", "network_unavailable", "unsupported_platform":
		default:
			return m, fmt.Errorf("invalid metrics error")
		}
		if seen[e] {
			return m, fmt.Errorf("duplicate metrics error")
		}
		seen[e] = true
	}
	if m.CPU != nil {
		if !required(raw["cpu"], "logical_cpus") || m.CPU.LogicalCPUs == 0 || m.CPU.LogicalCPUs > 1048576 || !optional(m.CPU.UsagePercent, 100) {
			return m, fmt.Errorf("invalid CPU metrics")
		}
	}
	if m.Memory != nil {
		v := m.Memory
		if !required(raw["memory"], "total_bytes", "available_bytes", "used_bytes", "swap_total_bytes", "swap_used_bytes") || !bounded(v.TotalBytes, 1e18) || v.TotalBytes == 0 || !bounded(v.AvailableBytes, v.TotalBytes) || !bounded(v.UsedBytes, v.TotalBytes) || math.Abs(v.UsedBytes+v.AvailableBytes-v.TotalBytes) > 1 || !bounded(v.SwapTotalBytes, 1e18) || !bounded(v.SwapUsedBytes, v.SwapTotalBytes) {
			return m, fmt.Errorf("invalid memory metrics")
		}
	}
	if m.Load != nil {
		v := m.Load
		if !required(raw["load"], "one", "five", "fifteen") || !bounded(v.One, 1e9) || !bounded(v.Five, 1e9) || !bounded(v.Fifteen, 1e9) {
			return m, fmt.Errorf("invalid load metrics")
		}
	}
	if m.Disk != nil {
		v := m.Disk
		if !required(raw["disk"], "total_bytes", "used_bytes", "available_bytes") || v.TotalBytes == 0 || !bounded(v.TotalBytes, 1e24) || !bounded(v.UsedBytes, v.TotalBytes) || !bounded(v.AvailableBytes, v.TotalBytes) || v.UsedBytes+v.AvailableBytes > v.TotalBytes {
			return m, fmt.Errorf("invalid disk metrics")
		}
	}
	if !optional(m.UptimeSeconds, 1e12) {
		return m, fmt.Errorf("invalid uptime")
	}
	var interfaces []json.RawMessage
	_ = json.Unmarshal(raw["interfaces"], &interfaces)
	if (seen["network_unavailable"] || seen["unsupported_platform"]) && len(m.Interfaces) > 0 {
		return m, fmt.Errorf("inconsistent network availability")
	}
	names := map[string]bool{}
	for i, v := range m.Interfaces {
		if v == nil || !required(interfaces[i], "name", "rx_bytes", "tx_bytes") || len(v.Name) == 0 || len(v.Name) > 64 || names[v.Name] || !bounded(v.RXBytes, 2e19) || !bounded(v.TXBytes, 2e19) || !optional(v.RXBytesPerSecond, 2e19) || !optional(v.TXBytesPerSecond, 2e19) {
			return m, fmt.Errorf("invalid network metrics")
		}
		names[v.Name] = true
	}
	// Every group must either report values or explicitly explain its absence.
	for _, g := range []struct {
		present bool
		name    string
	}{{m.CPU != nil, "cpu"}, {m.Memory != nil, "memory"}, {m.Load != nil, "load"}, {m.Disk != nil, "disk"}, {m.UptimeSeconds != nil, "uptime"}, {!seen["network_unavailable"] && !seen["unsupported_platform"], "network"}} {
		if g.present && (seen[g.name+"_unavailable"] || seen["unsupported_platform"]) || !g.present && !seen[g.name+"_unavailable"] && !seen["unsupported_platform"] {
			return m, fmt.Errorf("inconsistent metrics availability")
		}
	}
	if err := validateHost(m.Host, raw["host"]); err != nil {
		return m, err
	}
	return m, nil
}
func bounded(n, max float64) bool           { return !math.IsNaN(n) && !math.IsInf(n, 0) && n >= 0 && n <= max }
func optional(n *float64, max float64) bool { return n == nil || bounded(*n, max) }
func ptr(n float64) *float64                { return &n }

// Put drops duplicate/late snapshots. Metrics never enter the task journal.
func (s *Store) Put(node string, m v1.NodeMetrics, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, exists := s.entries[node]
	if exists && !m.SampledAt.After(e.latest.SampledAt) {
		return
	}
	if !exists && len(s.entries) >= MaxNodes {
		oldest := ""
		var at time.Time
		for key, v := range s.entries {
			if oldest == "" || v.received.Before(at) {
				oldest, at = key, v.received
			}
		}
		delete(s.entries, oldest)
	}
	point := Point{At: now.UTC()}
	if m.CPU != nil {
		point.CPU = m.CPU.UsagePercent
	}
	if m.Memory != nil {
		point.Memory = ptr(100 * m.Memory.UsedBytes / m.Memory.TotalBytes)
	}
	if m.Interfaces != nil && !slices.Contains(m.Errors, "network_unavailable") && !slices.Contains(m.Errors, "unsupported_platform") {
		rx, tx := 0.0, 0.0
		ok := true
		for _, v := range m.Interfaces {
			if v.RXBytesPerSecond == nil || v.TXBytesPerSecond == nil {
				ok = false
				break
			}
			rx += *v.RXBytesPerSecond
			tx += *v.TXBytesPerSecond
		}
		if ok {
			point.RX = ptr(rx)
			point.TX = ptr(tx)
		}
	}
	history := make([]Point, 0, MaxHistory)
	for _, p := range e.history {
		if p.At.After(now.Add(-time.Hour)) && p.At.Truncate(time.Minute) != now.Truncate(time.Minute) {
			history = append(history, p)
		}
	}
	history = append(history, point)
	if len(history) > MaxHistory {
		history = history[len(history)-MaxHistory:]
	}
	s.entries[node] = entry{latest: &m, received: now, history: history, reportInterval: e.reportInterval}
}
func (s *Store) Get(node string, now time.Time, history bool) Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[node]
	out := Snapshot{Stale: true, History: []Point{}}
	if !ok {
		return out
	}
	out.Latest = e.latest
	out.ReceivedAt = e.received.UTC()
	out.ReportIntervalSeconds = e.reportInterval
	ttl := time.Duration(math.Max(90, 3*math.Max(e.latest.IntervalSeconds, float64(e.reportInterval)))) * time.Second
	out.Stale = now.Sub(e.received) > ttl
	if history {
		for _, p := range e.history {
			if p.At.After(now.Add(-time.Hour)) {
				out.History = append(out.History, p)
			}
		}
	}
	return out
}

func (s *Store) SetReportInterval(node string, seconds uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.entries[node]; ok {
		e.reportInterval = seconds
		s.entries[node] = e
	}
}
