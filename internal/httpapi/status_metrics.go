package httpapi

import (
	"context"
	"fmt"
	"slices"
	"time"

	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type StatusFast struct {
	SampledAt   time.Time  `json:"sampled_at"`
	ExpiresAt   time.Time  `json:"expires_at"`
	CPU         *float64   `json:"cpu"`
	RAMUsed     *string    `json:"ram_used"`
	RAMTotal    *string    `json:"ram_total"`
	RX          *float64   `json:"rx"`
	TX          *float64   `json:"tx"`
	Quota       *string    `json:"quota"`
	PeriodRX    *string    `json:"period_rx"`
	PeriodTX    *string    `json:"period_tx"`
	PeriodEnd   *time.Time `json:"period_end"`
	BillingMode string     `json:"billing_mode"`
}
type StatusFull struct {
	SampledAt     time.Time `json:"sampled_at"`
	Stale         bool      `json:"stale"`
	Load1         *float64  `json:"load1"`
	Load5         *float64  `json:"load5"`
	Load15        *float64  `json:"load15"`
	DiskUsed      *string   `json:"disk_used"`
	DiskAvailable *string   `json:"disk_available"`
	DiskTotal     *string   `json:"disk_total"`
}
type StatusProbePoint struct {
	At   time.Time `json:"at"`
	Ping float64   `json:"ping"`
	Loss uint64    `json:"loss"`
}
type StatusLine struct {
	Slot    int                `json:"slot"`
	Name    string             `json:"name"`
	History []StatusProbePoint `json:"history"`
	Latest  *StatusProbePoint  `json:"latest"`
}
type StatusSpeed struct {
	At time.Time `json:"at"`
	RX *float64  `json:"rx"`
	TX *float64  `json:"tx"`
}
type StatusNode struct {
	inventory.PublishedNode
	Online   bool                       `json:"online"`
	Country  string                     `json:"country"`
	OS       string                     `json:"os"`
	Group    string                     `json:"group"`
	Tags     []string                   `json:"tags"`
	IPv4     bool                       `json:"ipv4"`
	IPv6     bool                       `json:"ipv6"`
	IPAt     *time.Time                 `json:"ip_at"`
	Uptime   *float64                   `json:"uptime"`
	UptimeAt *string                    `json:"uptime_at"`
	Price    *string                    `json:"price"`
	Currency string                     `json:"currency"`
	Months   *int                       `json:"months"`
	Expires  *string                    `json:"expires"`
	Lifetime *inventory.TrafficLifetime `json:"lifetime"`
	Fast     *StatusFast                `json:"fast"`
	Full     *StatusFull                `json:"full"`
	Lines    []StatusLine               `json:"lines"`
	Speeds   []StatusSpeed              `json:"speeds"`
}

func statusLines(config *v1.TelemetryTCPProbeSettings, history monitoring.TCPHistory, live *v1.TelemetryTCPProbeBatch) []StatusLine {
	lines := []StatusLine{}
	if config == nil {
		return lines
	}
	for i, target := range config.Targets {
		name := fmt.Sprintf("线路 %d", i+1)
		if i < len(config.Names) && config.Names[i] != "" && config.Names[i] != target {
			name = config.Names[i]
		}
		line := StatusLine{Slot: i + 1, Name: name, History: []StatusProbePoint{}}
		point := func(batch *v1.TelemetryTCPProbeBatch) *StatusProbePoint {
			if batch != nil {
				for _, p := range batch.Targets {
					if p != nil && p.Target == target {
						return &StatusProbePoint{At: batch.SampledAt, Ping: p.Ping, Loss: p.Loss}
					}
				}
			}
			return nil
		}
		for _, bucket := range history.Points {
			if p := point(&bucket.TelemetryTCPProbeBatch); p != nil {
				line.History = append(line.History, *p)
				line.Latest = p
			}
		}
		if p := point(live); p != nil && (line.Latest == nil || !p.At.Before(line.Latest.At)) {
			line.Latest = p
		}
		lines = append(lines, line)
	}
	return lines
}
func (a *api) statusNode(ctx context.Context, repo statusRepository, entry inventory.PublishedNode, now time.Time) (StatusNode, error) {
	n, err := a.Nodes.Node(ctx, entry.ID)
	if err != nil {
		return StatusNode{}, err
	}
	out := StatusNode{
		PublishedNode: entry, Online: n.State == "online", Country: n.Location.CountryCode,
		OS: n.OS, Tags: []string{}, Speeds: []StatusSpeed{},
		Uptime: n.UptimeSeconds, UptimeAt: n.UptimeSampledAt,
		Price: n.Billing.Price, Currency: n.Billing.Currency, Months: n.Billing.PeriodMonths, Expires: n.Billing.ExpiresAt,
	}
	for _, c := range n.Categories {
		if c.Shared {
			if c.Kind == "group" {
				out.Group = c.Name
			} else {
				out.Tags = append(out.Tags, c.Name)
			}
		}
	}
	if n.Inventory != nil {
		out.IPv4 = n.Inventory.PublicIpv4 != ""
		out.IPv6 = n.Inventory.PublicIpv6 != ""
		out.IPAt = &n.Inventory.SampledAt
		if n.Inventory.OSName != "" {
			out.OS = n.Inventory.OSName
		}
	}
	out.Lifetime, err = repo.StatusLifetime(ctx, n.ID, now)
	if err != nil {
		return out, err
	}
	cfg, err := repo.TelemetrySettings(ctx, n.ID)
	if err != nil {
		return out, err
	}
	var batch *v1.TelemetryTCPProbeBatch
	if a.Gateway != nil {
		snapshot, err := a.Gateway.ReadMetrics(n.ID, monitoring.Cursor{}, false)
		if err != nil {
			return out, err
		}
		if t := snapshot.Telemetry; t != nil {
			if ip := t.PublicIP; ip != nil && (out.IPAt == nil || !ip.SampledAt.Before(*out.IPAt)) {
				out.IPv4, out.IPv6, out.IPAt = ip.Ipv4 != "", ip.Ipv6 != "", &ip.SampledAt
			}
			if f := t.Fast; f != nil {
				summary := monitoring.Summarize(snapshot.Snapshot)
				fast := &StatusFast{SampledAt: f.SampledAt, ExpiresAt: summary.ExpiresAt, CPU: summary.CPU}
				if summary.Memory != nil {
					fast.RAMUsed, fast.RAMTotal = f.RamUsed, f.RamTotal
				}
				if len(f.Interfaces) > 0 {
					rx, tx := 0.0, 0.0
					for _, nic := range f.Interfaces {
						if nic == nil || nic.RXBytesPerSecond == nil || nic.TXBytesPerSecond == nil {
							fast.RX, fast.TX = nil, nil
							break
						}
						rx += *nic.RXBytesPerSecond
						tx += *nic.TXBytesPerSecond
						fast.RX, fast.TX = &rx, &tx
					}
				}
				if t.Settings != nil {
					fast.BillingMode = "both"
					quota := "0"
					fast.Quota = &quota
					if tr := t.Settings.Traffic; tr != nil {
						fast.BillingMode, fast.Quota = tr.BillingMode, &tr.QuotaBytes
					}
				}
				if tr := f.Traffic; tr != nil && !slices.Contains(f.Errors, "traffic_unavailable") {
					fast.PeriodEnd = &tr.PeriodEnd
					if len(tr.Quality) == 0 {
						fast.PeriodRX, fast.PeriodTX = tr.RXBytes, tr.TXBytes
					}
				}
				out.Fast = fast
			}
			if f := t.Full; f != nil {
				out.Full = &StatusFull{
					SampledAt: f.SampledAt, Stale: t.FullStale,
					Load1: f.Load1, Load5: f.Load5, Load15: f.Load15,
					DiskUsed: f.DiskUsed, DiskAvailable: f.DiskAvailable, DiskTotal: f.DiskTotal,
				}
				batch = f.TcpProbes
				if f.OSName != "" {
					out.OS = f.OSName
				}
			}
			for _, p := range t.Points {
				if p.Group == "fast" {
					speed := StatusSpeed{At: p.At}
					if v, ok := p.Values["rx_bytes_per_second"]; ok {
						speed.RX = &v
					}
					if v, ok := p.Values["tx_bytes_per_second"]; ok {
						speed.TX = &v
					}
					out.Speeds = append(out.Speeds, speed)
				}
			}
			if len(out.Speeds) > 20 {
				out.Speeds = out.Speeds[len(out.Speeds)-20:]
			}
		}
	}
	var history monitoring.TCPHistory
	if cfg.TcpProbe != nil && len(cfg.TcpProbe.Targets) > 0 && a.TCPHistory != nil {
		history, err = a.TCPHistory.TCPProbeHistory(ctx, n.ID, "", now.Add(-time.Hour), now, now, 300)
		if err != nil {
			return out, err
		}
	}
	out.Lines = statusLines(cfg.TcpProbe, history, batch)
	return out, nil
}
