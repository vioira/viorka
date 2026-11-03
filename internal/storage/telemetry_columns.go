package storage

import "github.com/vioira/viorka/internal/monitoring"

const historyCurrentDDL = `CREATE TABLE metrics_history (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  bucket_start INTEGER NOT NULL CHECK(bucket_start>=0 AND bucket_start%30=0),
  last_sample_at INTEGER NOT NULL CHECK(last_sample_at>=bucket_start*1000 AND last_sample_at<(bucket_start+30)*1000),
  cpu_avg REAL CHECK(cpu_avg>=0),
  ram_used_avg REAL CHECK(ram_used_avg>=0),
  swap_used_avg REAL CHECK(swap_used_avg>=0),
  net_in_speed_max REAL CHECK(net_in_speed_max>=0),
  net_out_speed_max REAL CHECK(net_out_speed_max>=0),
  tcp_count_max INTEGER CHECK(tcp_count_max BETWEEN 0 AND 1048576),
  udp_count_max INTEGER CHECK(udp_count_max BETWEEN 0 AND 1048576),
  process_count_max INTEGER CHECK(process_count_max BETWEEN 0 AND 1048576),
  disk_read_speed_max REAL CHECK(disk_read_speed_max>=0),
  disk_write_speed_max REAL CHECK(disk_write_speed_max>=0),
  disk_read_iops_max REAL CHECK(disk_read_iops_max>=0),
  disk_write_iops_max REAL CHECK(disk_write_iops_max>=0),
  disk_await_ms_max REAL CHECK(disk_await_ms_max>=0),
  disk_util_percent_max REAL CHECK(disk_util_percent_max>=0 AND disk_util_percent_max<=100),
  ram_total INTEGER CHECK(ram_total>=0),
  swap_total INTEGER CHECK(swap_total>=0),
  net_in_total INTEGER CHECK(net_in_total>=0),
  net_out_total INTEGER CHECK(net_out_total>=0),
  net_month_in INTEGER CHECK(net_month_in>=0),
  net_month_out INTEGER CHECK(net_month_out>=0),
  traffic_period_start INTEGER CHECK(traffic_period_start>=0),
  disk_total INTEGER CHECK(disk_total>=0),
  disk_used INTEGER CHECK(disk_used>=0),
  disk_available INTEGER CHECK(disk_available>=0),
  load_1 REAL CHECK(load_1>=0),
  load_5 REAL CHECK(load_5>=0),
  load_15 REAL CHECK(load_15>=0),
  uptime_seconds REAL CHECK(uptime_seconds>=0),
  updated_at INTEGER NOT NULL CHECK(updated_at>=0),
  PRIMARY KEY(node_id,bucket_start)
) STRICT;
CREATE INDEX idx_metrics_history_time ON metrics_history(bucket_start);`
const historyColumns = "node_id,bucket_start,last_sample_at,cpu_avg,ram_used_avg,swap_used_avg,net_in_speed_max,net_out_speed_max,tcp_count_max,udp_count_max,process_count_max,disk_read_speed_max,disk_write_speed_max,disk_read_iops_max,disk_write_iops_max,disk_await_ms_max,disk_util_percent_max,ram_total,swap_total,net_in_total,net_out_total,net_month_in,net_month_out,traffic_period_start,disk_total,disk_used,disk_available,load_1,load_5,load_15,uptime_seconds,updated_at"
const historyPlaceholders = "?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?"
const historyUpdates = "last_sample_at=excluded.last_sample_at,cpu_avg=excluded.cpu_avg,ram_used_avg=excluded.ram_used_avg,swap_used_avg=excluded.swap_used_avg,net_in_speed_max=excluded.net_in_speed_max,net_out_speed_max=excluded.net_out_speed_max,tcp_count_max=excluded.tcp_count_max,udp_count_max=excluded.udp_count_max,process_count_max=excluded.process_count_max,disk_read_speed_max=excluded.disk_read_speed_max,disk_write_speed_max=excluded.disk_write_speed_max,disk_read_iops_max=excluded.disk_read_iops_max,disk_write_iops_max=excluded.disk_write_iops_max,disk_await_ms_max=excluded.disk_await_ms_max,disk_util_percent_max=excluded.disk_util_percent_max,ram_total=excluded.ram_total,swap_total=excluded.swap_total,net_in_total=excluded.net_in_total,net_out_total=excluded.net_out_total,net_month_in=excluded.net_month_in,net_month_out=excluded.net_month_out,traffic_period_start=excluded.traffic_period_start,disk_total=excluded.disk_total,disk_used=excluded.disk_used,disk_available=excluded.disk_available,load_1=excluded.load_1,load_5=excluded.load_5,load_15=excluded.load_15,uptime_seconds=excluded.uptime_seconds,updated_at=excluded.updated_at"

func historyValues(b *monitoring.Bucket) []any {
	return []any{b.Node, b.Start, b.LastSample, b.CPU.Average(), b.RAMUsed.Average(), b.SwapUsed.Average(), b.NetInSpeed.Max, b.NetOutSpeed.Max, b.TCPCount.Max, b.UDPCount.Max, b.ProcessCount.Max, b.DiskIO.ReadSpeed.Max, b.DiskIO.WriteSpeed.Max, b.DiskIO.ReadIOPS.Max, b.DiskIO.WriteIOPS.Max, b.DiskIO.Await.Max, b.DiskIO.Util.Max, b.RAMTotal, b.SwapTotal, b.NetInTotal, b.NetOutTotal, b.MonthIn, b.MonthOut, b.MonthStart, b.DiskTotal, b.DiskUsed, b.DiskAvailable, b.Load1, b.Load5, b.Load15, b.Uptime, b.UpdatedAt}
}
func historyTargets(b *monitoring.Bucket) []any {
	return []any{&b.Node, &b.Start, &b.LastSample, &b.CPU.Sum, &b.RAMUsed.Sum, &b.SwapUsed.Sum, &b.NetInSpeed.Max, &b.NetOutSpeed.Max, &b.TCPCount.Max, &b.UDPCount.Max, &b.ProcessCount.Max, &b.DiskIO.ReadSpeed.Max, &b.DiskIO.WriteSpeed.Max, &b.DiskIO.ReadIOPS.Max, &b.DiskIO.WriteIOPS.Max, &b.DiskIO.Await.Max, &b.DiskIO.Util.Max, &b.RAMTotal, &b.SwapTotal, &b.NetInTotal, &b.NetOutTotal, &b.MonthIn, &b.MonthOut, &b.MonthStart, &b.DiskTotal, &b.DiskUsed, &b.DiskAvailable, &b.Load1, &b.Load5, &b.Load15, &b.Uptime, &b.UpdatedAt}
}

// Loaded values each represent one fixed bucket, never original sample counts.
func restoreHistoryBucket(b *monitoring.Bucket) {
	b.Sealed = true
	for _, m := range []*monitoring.Mean{&b.CPU, &b.RAMUsed, &b.SwapUsed} {
		if m.Sum != nil {
			m.Count = 1
		}
	}
	for _, p := range []*monitoring.Peak{&b.NetInSpeed, &b.NetOutSpeed, &b.TCPCount, &b.UDPCount, &b.ProcessCount, &b.DiskIO.ReadSpeed, &b.DiskIO.WriteSpeed, &b.DiskIO.ReadIOPS, &b.DiskIO.WriteIOPS, &b.DiskIO.Await, &b.DiskIO.Util} {
		if p.Max != nil {
			p.Count = 1
		}
	}
	at := uint64(b.LastSample)
	if b.RAMTotal != nil || b.SwapTotal != nil {
		b.MemoryAt = &at
	}
	if b.NetInTotal != nil {
		b.NetworkAt = &at
	}
	if b.MonthStart != nil {
		b.TrafficAt = &at
	}
	if b.DiskTotal != nil {
		b.DiskAt = &at
	}
	if b.Load1 != nil {
		b.LoadAt = &at
	}
	if b.Uptime != nil {
		b.UptimeAt = &at
	}
}
