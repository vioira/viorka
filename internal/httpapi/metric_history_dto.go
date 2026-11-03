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
	Start         int64       `json:"bucket_start"`
	LastSample    int64       `json:"last_sample_at"`
	RAMTotal      *string     `json:"ram_total"`
	SwapTotal     *string     `json:"swap_total"`
	NetInTotal    *string     `json:"net_in_total"`
	NetOutTotal   *string     `json:"net_out_total"`
	MonthIn       *string     `json:"net_month_in"`
	MonthOut      *string     `json:"net_month_out"`
	MonthStart    *uint64     `json:"traffic_period_start"`
	DiskTotal     *string     `json:"disk_total"`
	DiskUsed      *string     `json:"disk_used"`
	DiskAvailable *string     `json:"disk_available"`
	Load1         *float64    `json:"load_1"`
	Load5         *float64    `json:"load_5"`
	Load15        *float64    `json:"load_15"`
	Uptime        *float64    `json:"uptime_seconds"`
	UpdatedAt     int64       `json:"updated_at"`
	CPU           HistoryMean `json:"cpu"`
	RAMUsed       HistoryMean `json:"ram_used"`
	SwapUsed      HistoryMean `json:"swap_used"`
	NetInSpeed    HistoryPeak `json:"net_in_speed"`
	NetOutSpeed   HistoryPeak `json:"net_out_speed"`
	TCPCount      HistoryPeak `json:"tcp_count"`
	UDPCount      HistoryPeak `json:"udp_count"`
	ProcessCount  HistoryPeak `json:"process_count"`
	DiskIO        HistoryDisk `json:"disk_io"`
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
			Start:         b.Start,
			LastSample:    b.LastSample,
			RAMTotal:      decimalCounter(b.RAMTotal),
			SwapTotal:     decimalCounter(b.SwapTotal),
			NetInTotal:    decimalCounter(b.NetInTotal),
			NetOutTotal:   decimalCounter(b.NetOutTotal),
			MonthIn:       decimalCounter(b.MonthIn),
			MonthOut:      decimalCounter(b.MonthOut),
			MonthStart:    b.MonthStart,
			DiskTotal:     decimalCounter(b.DiskTotal),
			DiskUsed:      decimalCounter(b.DiskUsed),
			DiskAvailable: decimalCounter(b.DiskAvailable),
			Load1:         b.Load1,
			Load5:         b.Load5,
			Load15:        b.Load15,
			Uptime:        b.Uptime,
			UpdatedAt:     b.UpdatedAt,
			CPU:           HistoryMean{b.CPU.Average()},
			RAMUsed:       HistoryMean{b.RAMUsed.Average()},
			SwapUsed:      HistoryMean{b.SwapUsed.Average()},
			NetInSpeed:    HistoryPeak{b.NetInSpeed.Max},
			NetOutSpeed:   HistoryPeak{b.NetOutSpeed.Max},
			TCPCount:      HistoryPeak{b.TCPCount.Max},
			UDPCount:      HistoryPeak{b.UDPCount.Max},
			ProcessCount:  HistoryPeak{b.ProcessCount.Max},
			DiskIO:        HistoryDisk{HistoryPeak{b.DiskIO.ReadSpeed.Max}, HistoryPeak{b.DiskIO.WriteSpeed.Max}, HistoryPeak{b.DiskIO.ReadIOPS.Max}, HistoryPeak{b.DiskIO.WriteIOPS.Max}, HistoryPeak{b.DiskIO.Await.Max}, HistoryPeak{b.DiskIO.Util.Max}},
		}
		out.Points = append(out.Points, p)
	}
	return out
}

type HistoryMean struct {
	Average *float64 `json:"avg"`
}
type HistoryPeak struct {
	Max *float64 `json:"max"`
}
type HistoryDisk struct {
	ReadSpeed  HistoryPeak `json:"read_speed"`
	WriteSpeed HistoryPeak `json:"write_speed"`
	ReadIOPS   HistoryPeak `json:"read_iops"`
	WriteIOPS  HistoryPeak `json:"write_iops"`
	Await      HistoryPeak `json:"await_ms"`
	Util       HistoryPeak `json:"util_percent"`
}
