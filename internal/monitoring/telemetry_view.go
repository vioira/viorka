package monitoring

import (
	v1 "github.com/vioira/viorka/protocol/v1"
	"slices"
	"strconv"
	"time"
)

// Telemetry views are REST/SSE projections. Exact integer counters and identities
// use decimal strings; the Agent wire protocol retains its uint64 types.
type TelemetryInterfaceView struct {
	Name             string   `json:"name"`
	Ifindex          string   `json:"ifindex"`
	RXBytes          string   `json:"rx_bytes"`
	TXBytes          string   `json:"tx_bytes"`
	RXBytesPerSecond *float64 `json:"rx_bytes_per_second,omitempty"`
	TXBytesPerSecond *float64 `json:"tx_bytes_per_second,omitempty"`
	Quality          []string `json:"quality"`
}
type TelemetryTrafficView struct {
	PeriodEnd      time.Time `json:"period_end,omitempty"`
	MonthStart     time.Time `json:"month_start"`
	RXBytes        *string   `json:"rx_bytes,omitempty"`
	TXBytes        *string   `json:"tx_bytes,omitempty"`
	FilterRevision string    `json:"filter_revision"`
	Quality        []string  `json:"quality"`
}
type TelemetryFastView struct {
	Sequence       string                    `json:"sequence"`
	SampledAt      time.Time                 `json:"sampled_at"`
	ElapsedSeconds float64                   `json:"elapsed_seconds"`
	CPUPercent     *float64                  `json:"cpu_percent,omitempty"`
	RamTotal       *string                   `json:"ram_total,omitempty"`
	RamUsed        *string                   `json:"ram_used,omitempty"`
	SwapTotal      *string                   `json:"swap_total,omitempty"`
	SwapUsed       *string                   `json:"swap_used,omitempty"`
	UptimeSeconds  *float64                  `json:"uptime_seconds,omitempty"`
	TcpInuse       *string                   `json:"tcp_inuse,omitempty"`
	UdpInuse       *string                   `json:"udp_inuse,omitempty"`
	Interfaces     []*TelemetryInterfaceView `json:"interfaces"`
	FilterRevision string                    `json:"filter_revision"`
	Traffic        *TelemetryTrafficView     `json:"traffic,omitempty"`
	Errors         []string                  `json:"errors"`
}
type TelemetryDiskIOView struct {
	ReadBytesPerSecond  *float64 `json:"read_bytes_per_second,omitempty"`
	WriteBytesPerSecond *float64 `json:"write_bytes_per_second,omitempty"`
	ReadIops            *float64 `json:"read_iops,omitempty"`
	WriteIops           *float64 `json:"write_iops,omitempty"`
	ReadAwaitMs         *float64 `json:"read_await_ms,omitempty"`
	WriteAwaitMs        *float64 `json:"write_await_ms,omitempty"`
	AwaitMs             *float64 `json:"await_ms,omitempty"`
	UtilPercent         *float64 `json:"util_percent,omitempty"`
	Quality             []string `json:"quality"`
}
type TelemetryFullView struct {
	Sequence       string               `json:"sequence"`
	SampledAt      time.Time            `json:"sampled_at"`
	ElapsedSeconds float64              `json:"elapsed_seconds"`
	Load1          *float64             `json:"load_1,omitempty"`
	Load5          *float64             `json:"load_5,omitempty"`
	Load15         *float64             `json:"load_15,omitempty"`
	Processes      *string              `json:"processes,omitempty"`
	DiskTotal      *string              `json:"disk_total,omitempty"`
	DiskUsed       *string              `json:"disk_used,omitempty"`
	DiskAvailable  *string              `json:"disk_available,omitempty"`
	DiskIo         *TelemetryDiskIOView `json:"disk_io,omitempty"`
	OSID           string               `json:"os_id,omitempty"`
	OSName         string               `json:"os_name,omitempty"`
	OSVersion      string               `json:"os_version,omitempty"`
	Errors         []string             `json:"errors"`
}
type TelemetryPublicIPView struct {
	Sequence  string    `json:"sequence"`
	SampledAt time.Time `json:"sampled_at"`
	Ipv4      string    `json:"ipv4,omitempty"`
	Ipv6      string    `json:"ipv6,omitempty"`
	Errors    []string  `json:"errors"`
}

func telemetryInterfaceView(v *v1.TelemetryInterface) *TelemetryInterfaceView {
	if v == nil {
		return nil
	}
	out := &TelemetryInterfaceView{
		Name:             v.Name,
		Ifindex:          strconv.FormatUint(v.Ifindex, 10),
		RXBytes:          strconv.FormatUint(v.RXBytes, 10),
		TXBytes:          strconv.FormatUint(v.TXBytes, 10),
		RXBytesPerSecond: copyTelemetryValue(v.RXBytesPerSecond),
		TXBytesPerSecond: copyTelemetryValue(v.TXBytesPerSecond),
		Quality:          slices.Clone(v.Quality),
	}
	return out
}
func telemetryTrafficView(v *v1.TelemetryTraffic) *TelemetryTrafficView {
	if v == nil {
		return nil
	}
	out := &TelemetryTrafficView{
		MonthStart:     v.MonthStart,
		PeriodEnd:      v.PeriodEnd,
		RXBytes:        telemetryDecimal(v.RXBytes),
		TXBytes:        telemetryDecimal(v.TXBytes),
		FilterRevision: v.FilterRevision,
		Quality:        slices.Clone(v.Quality),
	}
	return out
}
func telemetryFastView(v *v1.TelemetryFast) *TelemetryFastView {
	if v == nil {
		return nil
	}
	out := &TelemetryFastView{
		Sequence:       strconv.FormatUint(v.Sequence, 10),
		SampledAt:      v.SampledAt,
		ElapsedSeconds: v.ElapsedSeconds,
		CPUPercent:     copyTelemetryValue(v.CPUPercent),
		RamTotal:       telemetryDecimal(v.RamTotal),
		RamUsed:        telemetryDecimal(v.RamUsed),
		SwapTotal:      telemetryDecimal(v.SwapTotal),
		SwapUsed:       telemetryDecimal(v.SwapUsed),
		UptimeSeconds:  copyTelemetryValue(v.UptimeSeconds),
		TcpInuse:       telemetryDecimal(v.TcpInuse),
		UdpInuse:       telemetryDecimal(v.UdpInuse),
		FilterRevision: v.FilterRevision,
		Traffic:        telemetryTrafficView(v.Traffic),
		Errors:         slices.Clone(v.Errors),
	}
	out.Interfaces = make([]*TelemetryInterfaceView, 0, len(v.Interfaces))
	for _, item := range v.Interfaces {
		out.Interfaces = append(out.Interfaces, telemetryInterfaceView(item))
	}
	return out
}
func telemetryDiskIOView(v *v1.TelemetryDiskIO) *TelemetryDiskIOView {
	if v == nil {
		return nil
	}
	out := &TelemetryDiskIOView{
		ReadBytesPerSecond:  copyTelemetryValue(v.ReadBytesPerSecond),
		WriteBytesPerSecond: copyTelemetryValue(v.WriteBytesPerSecond),
		ReadIops:            copyTelemetryValue(v.ReadIops),
		WriteIops:           copyTelemetryValue(v.WriteIops),
		ReadAwaitMs:         copyTelemetryValue(v.ReadAwaitMs),
		WriteAwaitMs:        copyTelemetryValue(v.WriteAwaitMs),
		AwaitMs:             copyTelemetryValue(v.AwaitMs),
		UtilPercent:         copyTelemetryValue(v.UtilPercent),
		Quality:             slices.Clone(v.Quality),
	}
	return out
}
func telemetryFullView(v *v1.TelemetryFull) *TelemetryFullView {
	if v == nil {
		return nil
	}
	out := &TelemetryFullView{
		Sequence:       strconv.FormatUint(v.Sequence, 10),
		SampledAt:      v.SampledAt,
		ElapsedSeconds: v.ElapsedSeconds,
		Load1:          copyTelemetryValue(v.Load1),
		Load5:          copyTelemetryValue(v.Load5),
		Load15:         copyTelemetryValue(v.Load15),
		Processes:      telemetryDecimal(v.Processes),
		DiskTotal:      telemetryDecimal(v.DiskTotal),
		DiskUsed:       telemetryDecimal(v.DiskUsed),
		DiskAvailable:  telemetryDecimal(v.DiskAvailable),
		OSID:           v.OSID,
		OSName:         v.OSName,
		OSVersion:      v.OSVersion,
		Errors:         slices.Clone(v.Errors),
	}
	out.DiskIo = telemetryDiskIOView(v.DiskIo)
	return out
}
func telemetryPublicIPView(v *v1.TelemetryPublicIP) *TelemetryPublicIPView {
	if v == nil {
		return nil
	}
	out := &TelemetryPublicIPView{
		Sequence:  strconv.FormatUint(v.Sequence, 10),
		SampledAt: v.SampledAt,
		Ipv4:      v.Ipv4,
		Ipv6:      v.Ipv6,
		Errors:    slices.Clone(v.Errors),
	}
	return out
}
func telemetryDecimal(v *uint64) *string {
	if v == nil {
		return nil
	}
	s := strconv.FormatUint(*v, 10)
	return &s
}
func copyTelemetryValue[T any](v *T) *T {
	if v == nil {
		return nil
	}
	value := *v
	return &value
}

// TelemetrySnapshot retains each group's own observation time and provenance.
// Management connectivity is supplied separately by the gateway; an offline
// management socket cannot make a recently accepted HTTP observation stale.
type TelemetrySnapshot struct {
	RunID              string                 `json:"run_id"`
	MetricsReceivedAt  time.Time              `json:"metrics_received_at"`
	Fast               *TelemetryFastView     `json:"fast,omitempty"`
	Full               *TelemetryFullView     `json:"full,omitempty"`
	PublicIP           *TelemetryPublicIPView `json:"public_ip,omitempty"`
	FastReceivedAt     time.Time              `json:"fast_received_at"`
	FullReceivedAt     time.Time              `json:"full_received_at"`
	PublicIPReceivedAt time.Time              `json:"public_ip_received_at"`
	FastStale          bool                   `json:"fast_stale"`
	FullStale          bool                   `json:"full_stale"`
	PublicIPStale      bool                   `json:"public_ip_stale"`
}

func (s TelemetrySnapshot) freshness(now time.Time, settings v1.TelemetrySettings, realtime bool) TelemetrySnapshot {
	fastTTL := fastTTL(settings, realtime)
	fullTTL := time.Duration(max(uint64(90), 3*settings.HttpReportSeconds)) * time.Second
	stale := func(sampled, received time.Time, ttl time.Duration) bool {
		return sampled.IsZero() || received.IsZero() || !now.Before(sampled.Add(ttl)) || !now.Before(received.Add(ttl))
	}
	s.FastStale = s.Fast == nil
	if s.Fast != nil {
		s.FastStale = stale(s.Fast.SampledAt, s.FastReceivedAt, fastTTL)
	}
	s.FullStale = s.Full == nil
	if s.Full != nil {
		s.FullStale = stale(s.Full.SampledAt, s.FullReceivedAt, fullTTL)
	}
	s.PublicIPStale = s.PublicIP == nil
	if s.PublicIP != nil {
		s.PublicIPStale = stale(s.PublicIP.SampledAt, s.PublicIPReceivedAt, 1800*time.Second)
	}
	return s
}
