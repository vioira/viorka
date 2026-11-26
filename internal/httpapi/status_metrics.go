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
	SampledAt      time.Time  `json:"sampled_at"`
	ExpiresAt      time.Time  `json:"expires_at"`
	CPU            *float64   `json:"cpu"`
	RAMUsed        *string    `json:"ram_used"`
	RAMTotal       *string    `json:"ram_total"`
	SwapUsed       *string    `json:"swap_used,omitempty"`
	SwapTotal      *string    `json:"swap_total,omitempty"`
	RX             *float64   `json:"rx"`
	TX             *float64   `json:"tx"`
	TCPInuse       *string    `json:"tcp_inuse,omitempty"`
	UDPInuse       *string    `json:"udp_inuse,omitempty"`
	Quota          *string    `json:"quota"`
	PeriodRX       *string    `json:"period_rx"`
	PeriodTX       *string    `json:"period_tx"`
	PeriodStart    *time.Time `json:"period_start,omitempty"`
	PeriodEnd      *time.Time `json:"period_end"`
	BillingMode    string     `json:"billing_mode"`
	TrafficQuality []string   `json:"traffic_quality,omitempty"`
}
type StatusDiskIO struct {
	ReadBytesPerSecond  *float64 `json:"read_bytes_per_second,omitempty"`
	WriteBytesPerSecond *float64 `json:"write_bytes_per_second,omitempty"`
	ReadIops            *float64 `json:"read_iops,omitempty"`
	WriteIops           *float64 `json:"write_iops,omitempty"`
	AwaitMs             *float64 `json:"await_ms,omitempty"`
	UtilPercent         *float64 `json:"util_percent,omitempty"`
	Quality             []string `json:"quality"`
}
type StatusFull struct {
	ExpiresAt     time.Time     `json:"expires_at"`
	SampledAt     time.Time     `json:"sampled_at"`
	Stale         bool          `json:"stale"`
	Load1         *float64      `json:"load1"`
	Load5         *float64      `json:"load5"`
	Load15        *float64      `json:"load15"`
	Processes     *string       `json:"processes,omitempty"`
	DiskUsed      *string       `json:"disk_used"`
	DiskAvailable *string       `json:"disk_available"`
	DiskTotal     *string       `json:"disk_total"`
	DiskIO        *StatusDiskIO `json:"disk_io,omitempty"`
}
type StatusDailyTraffic struct {
	DayStart  time.Time `json:"day_start"`
	DayEnd    time.Time `json:"day_end"`
	RXBytes   string    `json:"rx_bytes"`
	TXBytes   string    `json:"tx_bytes"`
	SampledAt time.Time `json:"sampled_at"`
	Quality   uint64    `json:"quality"`
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
	MetricTrends monitoring.MetricTrends `json:"metric_trends,omitempty"`
	CPUCores     *int                    `json:"cpu_cores,omitempty" minimum:"1" maximum:"65536"`
	inventory.PublishedNode
	Online      bool                       `json:"online"`
	Kind        string                     `json:"kind"`
	Country     string                     `json:"country"`
	Subdivision string                     `json:"subdivision,omitempty"`
	City        string                     `json:"city,omitempty"`
	OS          string                     `json:"os"`
	Arch        string                     `json:"arch,omitempty"`
	Group       string                     `json:"group"`
	Tags        []string                   `json:"tags"`
	IPv4        bool                       `json:"ipv4"`
	IPv6        bool                       `json:"ipv6"`
	IPAt        *time.Time                 `json:"ip_at"`
	LastSeenAt  string                     `json:"last_seen_at,omitempty"`
	Uptime      *float64                   `json:"uptime"`
	UptimeAt    *string                    `json:"uptime_at"`
	Price       *string                    `json:"price"`
	Currency    string                     `json:"currency"`
	Months      *int                       `json:"months"`
	Expires     *string                    `json:"expires"`
	Lifetime    *inventory.TrafficLifetime `json:"lifetime"`
	Daily       *StatusDailyTraffic        `json:"daily,omitempty"`
	Fast        *StatusFast                `json:"fast"`
	Full        *StatusFull                `json:"full"`
	Lines       []StatusLine               `json:"lines"`
	Speeds      []StatusSpeed              `json:"speeds"`
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

type statusNodeSource struct {
	base    StatusNode
	probes  *v1.TelemetryTCPProbeSettings
	history monitoring.TCPHistory
}

func (a *api) statusNodeSource(ctx context.Context, repo statusRepository, entry inventory.PublishedNode, now time.Time) (statusNodeSource, error) {
	n, err := a.Nodes.Node(ctx, entry.ID)
	if err != nil {
		return statusNodeSource{}, err
	}
	out := StatusNode{
		PublishedNode: entry, CPUCores: n.CPUCores, Online: n.State == "online", Kind: n.Kind, Country: n.Location.CountryCode,
		Subdivision: n.Location.Subdivision, City: n.Location.City,
		OS: n.OS, Arch: n.Arch, LastSeenAt: n.LastSeenAt, Tags: []string{}, Speeds: []StatusSpeed{},
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
		return statusNodeSource{}, err
	}
	cfg, err := repo.TelemetrySettings(ctx, n.ID)
	if err != nil {
		return statusNodeSource{}, err
	}
	var history monitoring.TCPHistory
	if cfg.TcpProbe != nil && len(cfg.TcpProbe.Targets) > 0 && a.TCPHistory != nil {
		start := now.Truncate(3 * time.Minute).Add(-time.Hour)
		history, err = a.TCPHistory.TCPProbeHistory(ctx, n.ID, "", start, now, now, 60)
		if err != nil {
			return statusNodeSource{}, err
		}
	}
	return statusNodeSource{out, cfg.TcpProbe, history}, nil
}

func (a *api) projectStatusNode(source statusNodeSource) (StatusNode, error) {
	out := source.base
	var batch *v1.TelemetryTCPProbeBatch
	if a.Gateway != nil {
		snapshot, err := a.Gateway.ReadMetrics(out.ID, monitoring.Cursor{}, false)
		if err != nil {
			return out, err
		}
		if t := snapshot.Telemetry; t != nil {
			if d := t.DailyTraffic; d != nil {
				out.Daily = &StatusDailyTraffic{
					DayStart: d.DayStart, DayEnd: d.DayEnd,
					RXBytes: d.RXBytes, TXBytes: d.TXBytes,
					SampledAt: d.SampledAt, Quality: d.Quality,
				}
			}
			if ip := t.PublicIP; ip != nil && (out.IPAt == nil || !ip.SampledAt.Before(*out.IPAt)) {
				out.IPv4, out.IPv6, out.IPAt = ip.Ipv4 != "", ip.Ipv6 != "", &ip.SampledAt
			}
			if f := t.Fast; f != nil {
				summary := monitoring.Summarize(snapshot.Snapshot)
				fast := &StatusFast{SampledAt: f.SampledAt, ExpiresAt: summary.ExpiresAt, CPU: summary.CPU}
				if summary.Memory != nil {
					fast.RAMUsed, fast.RAMTotal = f.RamUsed, f.RamTotal
				}
				if !slices.Contains(f.Errors, "memory_unavailable") {
					fast.SwapUsed, fast.SwapTotal = f.SwapUsed, f.SwapTotal
				}
				if !slices.Contains(f.Errors, "sockets_unavailable") {
					fast.TCPInuse, fast.UDPInuse = f.TcpInuse, f.UdpInuse
				}
				if len(f.Interfaces) > 0 {
					fast.RX, fast.TX = new(float64), new(float64)
					for _, nic := range f.Interfaces {
						if nic == nil {
							fast.RX, fast.TX = nil, nil
							break
						}
						if nic.RXBytesPerSecond == nil {
							fast.RX = nil
						} else if fast.RX != nil {
							*fast.RX += *nic.RXBytesPerSecond
						}
						if nic.TXBytesPerSecond == nil {
							fast.TX = nil
						} else if fast.TX != nil {
							*fast.TX += *nic.TXBytesPerSecond
						}
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
					fast.PeriodStart = &tr.MonthStart
					fast.PeriodEnd = &tr.PeriodEnd
					fast.TrafficQuality = slices.Clone(tr.Quality)
					if len(tr.Quality) == 0 {
						fast.PeriodRX, fast.PeriodTX = tr.RXBytes, tr.TXBytes
					}
				}
				out.Fast = fast
			}
			if f := t.Full; f != nil {
				full := &StatusFull{
					SampledAt: f.SampledAt, ExpiresAt: t.FullExpiresAt, Stale: t.FullStale,
					Load1: f.Load1, Load5: f.Load5, Load15: f.Load15,
					DiskUsed: f.DiskUsed, DiskAvailable: f.DiskAvailable, DiskTotal: f.DiskTotal,
				}
				if !slices.Contains(f.Errors, "processes_unavailable") {
					full.Processes = f.Processes
				}
				if f.DiskIo != nil && !slices.Contains(f.Errors, "disk_io_unavailable") {
					quality := slices.Clone(f.DiskIo.Quality)
					if quality == nil {
						quality = []string{}
					}
					full.DiskIO = &StatusDiskIO{
						ReadBytesPerSecond:  f.DiskIo.ReadBytesPerSecond,
						WriteBytesPerSecond: f.DiskIo.WriteBytesPerSecond,
						ReadIops:            f.DiskIo.ReadIops,
						WriteIops:           f.DiskIo.WriteIops,
						AwaitMs:             f.DiskIo.AwaitMs,
						UtilPercent:         f.DiskIo.UtilPercent,
						Quality:             quality,
					}
				}
				out.Full = full
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
	out.Lines = statusLines(source.probes, source.history, batch)
	return out, nil
}
