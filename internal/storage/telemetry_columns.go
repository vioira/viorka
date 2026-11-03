package storage

import "github.com/vioira/viorka/internal/monitoring"

const historyCurrentDDL = `CREATE TABLE metrics_history (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  bucket_start INTEGER NOT NULL CHECK(bucket_start>=0 AND bucket_start%30=0),
  last_sample_at INTEGER NOT NULL CHECK(last_sample_at>=bucket_start*1000 AND last_sample_at<(bucket_start+30)*1000),
  fast_sample_count INTEGER NOT NULL CHECK(fast_sample_count>=0),
  full_sample_count INTEGER NOT NULL CHECK(full_sample_count>=0),
  metric_semantics TEXT NOT NULL CHECK(metric_semantics IN ('telemetry_v3','legacy','mixed')),
  quality_flags INTEGER NOT NULL CHECK(quality_flags BETWEEN 0 AND 1023),
  cpu_sum REAL CHECK(cpu_sum>=0),
  cpu_count INTEGER NOT NULL CHECK(cpu_count>=0),
  ram_used_sum REAL CHECK(ram_used_sum>=0),
  ram_used_count INTEGER NOT NULL CHECK(ram_used_count>=0),
  swap_used_sum REAL CHECK(swap_used_sum>=0),
  swap_used_count INTEGER NOT NULL CHECK(swap_used_count>=0),
  net_in_speed_max REAL CHECK(net_in_speed_max>=0),
  net_in_speed_count INTEGER NOT NULL CHECK(net_in_speed_count>=0),
  net_out_speed_max REAL CHECK(net_out_speed_max>=0),
  net_out_speed_count INTEGER NOT NULL CHECK(net_out_speed_count>=0),
  tcp_count_max INTEGER CHECK(tcp_count_max BETWEEN 0 AND 1048576),
  tcp_count_count INTEGER NOT NULL CHECK(tcp_count_count>=0),
  udp_count_max INTEGER CHECK(udp_count_max BETWEEN 0 AND 1048576),
  udp_count_count INTEGER NOT NULL CHECK(udp_count_count>=0),
  process_count_max INTEGER CHECK(process_count_max BETWEEN 0 AND 1048576),
  process_count_count INTEGER NOT NULL CHECK(process_count_count>=0),
  ram_total INTEGER CHECK(ram_total>=0),
  swap_total INTEGER CHECK(swap_total>=0),
  memory_sampled_at INTEGER CHECK(memory_sampled_at>=0),
  net_in_total INTEGER CHECK(net_in_total>=0),
  net_out_total INTEGER CHECK(net_out_total>=0),
  net_sampled_at INTEGER CHECK(net_sampled_at>=0),
  net_month_in INTEGER CHECK(net_month_in>=0),
  net_month_out INTEGER CHECK(net_month_out>=0),
  traffic_month_start INTEGER CHECK(traffic_month_start>=0),
  traffic_sampled_at INTEGER CHECK(traffic_sampled_at>=0),
  traffic_quality INTEGER CHECK(traffic_quality>=0),
  disk_total INTEGER CHECK(disk_total>=0),
  disk_used INTEGER CHECK(disk_used>=0),
  disk_available INTEGER CHECK(disk_available>=0),
  disk_sampled_at INTEGER CHECK(disk_sampled_at>=0),
  load_sampled_at INTEGER CHECK(load_sampled_at>=0),
  uptime_sampled_at INTEGER CHECK(uptime_sampled_at>=0),
  load_1 REAL CHECK(load_1>=0),
  load_5 REAL CHECK(load_5>=0),
  load_15 REAL CHECK(load_15>=0),
  uptime_seconds REAL CHECK(uptime_seconds>=0),
  filter_revision TEXT NOT NULL CHECK(length(filter_revision) IN (0,64)),
  traffic_filter_revision TEXT NOT NULL CHECK(length(traffic_filter_revision) IN (0,64)),
  updated_at INTEGER NOT NULL CHECK(updated_at>=0),
  CHECK((cpu_count=0 AND cpu_sum IS NULL) OR (cpu_count>0 AND cpu_sum IS NOT NULL)),
  CHECK((ram_used_count=0 AND ram_used_sum IS NULL) OR (ram_used_count>0 AND ram_used_sum IS NOT NULL)),
  CHECK((swap_used_count=0 AND swap_used_sum IS NULL) OR (swap_used_count>0 AND swap_used_sum IS NOT NULL)),
  CHECK((net_in_speed_count=0 AND net_in_speed_max IS NULL) OR (net_in_speed_count>0 AND net_in_speed_max IS NOT NULL)),
  CHECK((net_out_speed_count=0 AND net_out_speed_max IS NULL) OR (net_out_speed_count>0 AND net_out_speed_max IS NOT NULL)),
  CHECK((tcp_count_count=0 AND tcp_count_max IS NULL) OR (tcp_count_count>0 AND tcp_count_max IS NOT NULL)),
  CHECK((udp_count_count=0 AND udp_count_max IS NULL) OR (udp_count_count>0 AND udp_count_max IS NOT NULL)),
  CHECK((process_count_count=0 AND process_count_max IS NULL) OR (process_count_count>0 AND process_count_max IS NOT NULL)),
  CHECK(cpu_count<=fast_sample_count),
  CHECK(ram_used_count<=fast_sample_count),
  CHECK(swap_used_count<=fast_sample_count),
  CHECK(net_in_speed_count<=fast_sample_count),
  CHECK(net_out_speed_count<=fast_sample_count),
  CHECK(tcp_count_count<=fast_sample_count),
  CHECK(udp_count_count<=fast_sample_count),
  CHECK(process_count_count<=full_sample_count),
  CHECK(fast_sample_count+full_sample_count>0),
  PRIMARY KEY(node_id,bucket_start)
) STRICT;
CREATE INDEX idx_metrics_history_time ON metrics_history(bucket_start);
CREATE TABLE metrics_disk_io (
 node_id TEXT NOT NULL,
 bucket_start INTEGER NOT NULL,
 device_id TEXT NOT NULL CHECK(length(device_id) BETWEEN 1 AND 128),
 last_sample_at INTEGER NOT NULL CHECK(last_sample_at>=bucket_start*1000),
 read_speed_max REAL CHECK(read_speed_max>=0),
 read_speed_count INTEGER NOT NULL CHECK(read_speed_count>=0),
 write_speed_max REAL CHECK(write_speed_max>=0),
 write_speed_count INTEGER NOT NULL CHECK(write_speed_count>=0),
 read_iops_max REAL CHECK(read_iops_max>=0),
 read_iops_count INTEGER NOT NULL CHECK(read_iops_count>=0),
 write_iops_max REAL CHECK(write_iops_max>=0),
 write_iops_count INTEGER NOT NULL CHECK(write_iops_count>=0),
 read_await_max REAL CHECK(read_await_max>=0),
 read_await_count INTEGER NOT NULL CHECK(read_await_count>=0),
 write_await_max REAL CHECK(write_await_max>=0),
 write_await_count INTEGER NOT NULL CHECK(write_await_count>=0),
 await_max REAL CHECK(await_max>=0),
 await_count INTEGER NOT NULL CHECK(await_count>=0),
 util_max REAL CHECK(util_max>=0 AND util_max<=100),
 util_count INTEGER NOT NULL CHECK(util_count>=0),
 CHECK((read_speed_count=0 AND read_speed_max IS NULL) OR (read_speed_count>0 AND read_speed_max IS NOT NULL)),
 CHECK((write_speed_count=0 AND write_speed_max IS NULL) OR (write_speed_count>0 AND write_speed_max IS NOT NULL)),
 CHECK((read_iops_count=0 AND read_iops_max IS NULL) OR (read_iops_count>0 AND read_iops_max IS NOT NULL)),
 CHECK((write_iops_count=0 AND write_iops_max IS NULL) OR (write_iops_count>0 AND write_iops_max IS NOT NULL)),
 CHECK((read_await_count=0 AND read_await_max IS NULL) OR (read_await_count>0 AND read_await_max IS NOT NULL)),
 CHECK((write_await_count=0 AND write_await_max IS NULL) OR (write_await_count>0 AND write_await_max IS NOT NULL)),
 CHECK((await_count=0 AND await_max IS NULL) OR (await_count>0 AND await_max IS NOT NULL)),
 CHECK((util_count=0 AND util_max IS NULL) OR (util_count>0 AND util_max IS NOT NULL)),
 PRIMARY KEY(node_id,bucket_start,device_id),
 FOREIGN KEY(node_id,bucket_start) REFERENCES metrics_history(node_id,bucket_start) ON DELETE CASCADE
) STRICT;
CREATE TABLE metrics_filesystems (
 node_id TEXT NOT NULL,
 bucket_start INTEGER NOT NULL,
 filesystem_id TEXT NOT NULL CHECK(length(filesystem_id) BETWEEN 1 AND 256),
 mount_point TEXT NOT NULL CHECK(length(mount_point) BETWEEN 1 AND 4096 AND substr(mount_point,1,1)='/'),
 filesystem_type TEXT NOT NULL CHECK(length(filesystem_type) BETWEEN 1 AND 64),
 total_bytes INTEGER NOT NULL CHECK(total_bytes>=0),
 used_bytes INTEGER NOT NULL CHECK(used_bytes>=0 AND used_bytes<=total_bytes),
 available_bytes INTEGER NOT NULL CHECK(available_bytes>=0 AND available_bytes<=total_bytes),
 sampled_at INTEGER NOT NULL CHECK(sampled_at>=bucket_start*1000),
 PRIMARY KEY(node_id,bucket_start,filesystem_id),
 FOREIGN KEY(node_id,bucket_start) REFERENCES metrics_history(node_id,bucket_start) ON DELETE CASCADE
) STRICT;
`
const historyColumns = "node_id,bucket_start,last_sample_at,fast_sample_count,full_sample_count,metric_semantics,quality_flags,cpu_sum,cpu_count,ram_used_sum,ram_used_count,swap_used_sum,swap_used_count,net_in_speed_max,net_in_speed_count,net_out_speed_max,net_out_speed_count,tcp_count_max,tcp_count_count,udp_count_max,udp_count_count,process_count_max,process_count_count,ram_total,swap_total,memory_sampled_at,net_in_total,net_out_total,net_sampled_at,net_month_in,net_month_out,traffic_month_start,traffic_sampled_at,traffic_quality,disk_total,disk_used,disk_available,disk_sampled_at,load_sampled_at,uptime_sampled_at,load_1,load_5,load_15,uptime_seconds,filter_revision,traffic_filter_revision,updated_at"
const historyPlaceholders = "?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?"
const historyUpdates = "last_sample_at=excluded.last_sample_at,fast_sample_count=excluded.fast_sample_count,full_sample_count=excluded.full_sample_count,metric_semantics=excluded.metric_semantics,quality_flags=excluded.quality_flags,cpu_sum=excluded.cpu_sum,cpu_count=excluded.cpu_count,ram_used_sum=excluded.ram_used_sum,ram_used_count=excluded.ram_used_count,swap_used_sum=excluded.swap_used_sum,swap_used_count=excluded.swap_used_count,net_in_speed_max=excluded.net_in_speed_max,net_in_speed_count=excluded.net_in_speed_count,net_out_speed_max=excluded.net_out_speed_max,net_out_speed_count=excluded.net_out_speed_count,tcp_count_max=excluded.tcp_count_max,tcp_count_count=excluded.tcp_count_count,udp_count_max=excluded.udp_count_max,udp_count_count=excluded.udp_count_count,process_count_max=excluded.process_count_max,process_count_count=excluded.process_count_count,ram_total=excluded.ram_total,swap_total=excluded.swap_total,memory_sampled_at=excluded.memory_sampled_at,net_in_total=excluded.net_in_total,net_out_total=excluded.net_out_total,net_sampled_at=excluded.net_sampled_at,net_month_in=excluded.net_month_in,net_month_out=excluded.net_month_out,traffic_month_start=excluded.traffic_month_start,traffic_sampled_at=excluded.traffic_sampled_at,traffic_quality=excluded.traffic_quality,disk_total=excluded.disk_total,disk_used=excluded.disk_used,disk_available=excluded.disk_available,disk_sampled_at=excluded.disk_sampled_at,load_sampled_at=excluded.load_sampled_at,uptime_sampled_at=excluded.uptime_sampled_at,load_1=excluded.load_1,load_5=excluded.load_5,load_15=excluded.load_15,uptime_seconds=excluded.uptime_seconds,filter_revision=excluded.filter_revision,traffic_filter_revision=excluded.traffic_filter_revision,updated_at=excluded.updated_at"

func historyValues(b *monitoring.Bucket) []any {
	return []any{b.Node, b.Start, b.LastSample, b.FastCount, b.FullCount, b.Semantics, b.Quality, b.CPU.Sum, b.CPU.Count, b.RAMUsed.Sum, b.RAMUsed.Count, b.SwapUsed.Sum, b.SwapUsed.Count, b.NetInSpeed.Max, b.NetInSpeed.Count, b.NetOutSpeed.Max, b.NetOutSpeed.Count, b.TCPCount.Max, b.TCPCount.Count, b.UDPCount.Max, b.UDPCount.Count, b.ProcessCount.Max, b.ProcessCount.Count, b.RAMTotal, b.SwapTotal, b.MemoryAt, b.NetInTotal, b.NetOutTotal, b.NetworkAt, b.MonthIn, b.MonthOut, b.MonthStart, b.TrafficAt, b.TrafficQuality, b.DiskTotal, b.DiskUsed, b.DiskAvailable, b.DiskAt, b.LoadAt, b.UptimeAt, b.Load1, b.Load5, b.Load15, b.Uptime, b.FilterRevision, b.TrafficFilterRevision, b.UpdatedAt}
}
func historyTargets(b *monitoring.Bucket) []any {
	return []any{&b.Node, &b.Start, &b.LastSample, &b.FastCount, &b.FullCount, &b.Semantics, &b.Quality, &b.CPU.Sum, &b.CPU.Count, &b.RAMUsed.Sum, &b.RAMUsed.Count, &b.SwapUsed.Sum, &b.SwapUsed.Count, &b.NetInSpeed.Max, &b.NetInSpeed.Count, &b.NetOutSpeed.Max, &b.NetOutSpeed.Count, &b.TCPCount.Max, &b.TCPCount.Count, &b.UDPCount.Max, &b.UDPCount.Count, &b.ProcessCount.Max, &b.ProcessCount.Count, &b.RAMTotal, &b.SwapTotal, &b.MemoryAt, &b.NetInTotal, &b.NetOutTotal, &b.NetworkAt, &b.MonthIn, &b.MonthOut, &b.MonthStart, &b.TrafficAt, &b.TrafficQuality, &b.DiskTotal, &b.DiskUsed, &b.DiskAvailable, &b.DiskAt, &b.LoadAt, &b.UptimeAt, &b.Load1, &b.Load5, &b.Load15, &b.Uptime, &b.FilterRevision, &b.TrafficFilterRevision, &b.UpdatedAt}
}
