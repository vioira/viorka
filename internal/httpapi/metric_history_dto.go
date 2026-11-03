package httpapi

import (
	"github.com/vioira/viorka/internal/monitoring"
	"strconv"
)

// HistoryResponse uses decimal strings for byte counters that may exceed the
// exact integer range of JavaScript Number. Times remain UTC Unix timestamps.
type HistoryResponse struct {
	PeriodSeconds int            `json:"period_seconds"`
	Points        []HistoryPoint `json:"points"`
}
type HistoryPoint struct {
	Start                 int64                 `json:"bucket_start"`
	LastSample            int64                 `json:"last_sample_at"`
	FastCount             uint64                `json:"fast_sample_count"`
	FullCount             uint64                `json:"full_sample_count"`
	Semantics             string                `json:"metric_semantics"`
	Quality               uint64                `json:"quality_flags"`
	RAMTotal              *string               `json:"ram_total"`
	SwapTotal             *string               `json:"swap_total"`
	MemoryAt              *uint64               `json:"memory_sampled_at"`
	NetInTotal            *string               `json:"net_in_total"`
	NetOutTotal           *string               `json:"net_out_total"`
	NetworkAt             *uint64               `json:"net_sampled_at"`
	MonthIn               *string               `json:"net_month_in"`
	MonthOut              *string               `json:"net_month_out"`
	MonthStart            *uint64               `json:"traffic_month_start"`
	TrafficAt             *uint64               `json:"traffic_sampled_at"`
	TrafficQuality        *uint64               `json:"traffic_quality"`
	DiskTotal             *string               `json:"disk_total"`
	DiskUsed              *string               `json:"disk_used"`
	DiskAvailable         *string               `json:"disk_available"`
	DiskAt                *uint64               `json:"disk_sampled_at"`
	LoadAt                *uint64               `json:"load_sampled_at"`
	UptimeAt              *uint64               `json:"uptime_sampled_at"`
	Load1                 *float64              `json:"load_1"`
	Load5                 *float64              `json:"load_5"`
	Load15                *float64              `json:"load_15"`
	Uptime                *float64              `json:"uptime_seconds"`
	FilterRevision        string                `json:"filter_revision"`
	TrafficFilterRevision string                `json:"traffic_filter_revision"`
	UpdatedAt             int64                 `json:"updated_at"`
	CPU                   monitoring.Mean       `json:"cpu"`
	RAMUsed               monitoring.Mean       `json:"ram_used"`
	SwapUsed              monitoring.Mean       `json:"swap_used"`
	NetInSpeed            monitoring.Peak       `json:"net_in_speed"`
	NetOutSpeed           monitoring.Peak       `json:"net_out_speed"`
	TCPCount              monitoring.Peak       `json:"tcp_count"`
	UDPCount              monitoring.Peak       `json:"udp_count"`
	ProcessCount          monitoring.Peak       `json:"process_count"`
	DiskIO                monitoring.DiskBucket `json:"disk_io"`
	Filesystems           []HistoryFilesystem   `json:"filesystems"`
}
type HistoryFilesystem struct {
	Identity       string `json:"identity"`
	MountPoint     string `json:"mount_point"`
	FilesystemType string `json:"filesystem_type"`
	Total          string `json:"total_bytes"`
	Used           string `json:"used_bytes"`
	Available      string `json:"available_bytes"`
	SampledAt      int64  `json:"sampled_at"`
}

func decimalCounter(v *uint64) *string {
	if v == nil {
		return nil
	}
	s := strconv.FormatUint(*v, 10)
	return &s
}
func historyResponse(h monitoring.History) HistoryResponse {
	out := HistoryResponse{PeriodSeconds: h.PeriodSeconds, Points: []HistoryPoint{}}
	for _, b := range h.Points {
		p := HistoryPoint{
			Start:                 b.Start,
			LastSample:            b.LastSample,
			FastCount:             b.FastCount,
			FullCount:             b.FullCount,
			Semantics:             b.Semantics,
			Quality:               b.Quality,
			RAMTotal:              decimalCounter(b.RAMTotal),
			SwapTotal:             decimalCounter(b.SwapTotal),
			MemoryAt:              b.MemoryAt,
			NetInTotal:            decimalCounter(b.NetInTotal),
			NetOutTotal:           decimalCounter(b.NetOutTotal),
			NetworkAt:             b.NetworkAt,
			MonthIn:               decimalCounter(b.MonthIn),
			MonthOut:              decimalCounter(b.MonthOut),
			MonthStart:            b.MonthStart,
			TrafficAt:             b.TrafficAt,
			TrafficQuality:        b.TrafficQuality,
			DiskTotal:             decimalCounter(b.DiskTotal),
			DiskUsed:              decimalCounter(b.DiskUsed),
			DiskAvailable:         decimalCounter(b.DiskAvailable),
			DiskAt:                b.DiskAt,
			LoadAt:                b.LoadAt,
			UptimeAt:              b.UptimeAt,
			Load1:                 b.Load1,
			Load5:                 b.Load5,
			Load15:                b.Load15,
			Uptime:                b.Uptime,
			FilterRevision:        b.FilterRevision,
			TrafficFilterRevision: b.TrafficFilterRevision,
			UpdatedAt:             b.UpdatedAt,
			CPU:                   b.CPU,
			RAMUsed:               b.RAMUsed,
			SwapUsed:              b.SwapUsed,
			NetInSpeed:            b.NetInSpeed,
			NetOutSpeed:           b.NetOutSpeed,
			TCPCount:              b.TCPCount,
			UDPCount:              b.UDPCount,
			ProcessCount:          b.ProcessCount,
			DiskIO:                b.DiskIO,
			Filesystems:           []HistoryFilesystem{}}
		for _, f := range b.Filesystems {
			p.Filesystems = append(p.Filesystems, HistoryFilesystem{Identity: f.Identity, MountPoint: f.MountPoint, FilesystemType: f.FilesystemType, Total: strconv.FormatUint(f.Total, 10), Used: strconv.FormatUint(f.Used, 10), Available: strconv.FormatUint(f.Available, 10), SampledAt: f.SampledAt})
		}
		out.Points = append(out.Points, p)
	}
	return out
}
