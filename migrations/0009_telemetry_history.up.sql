-- Development schema: fixed 30-second bucket values.
CREATE TABLE metrics_history (
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
CREATE INDEX idx_metrics_history_time ON metrics_history(bucket_start);
CREATE TABLE metrics_history_old (
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
CREATE INDEX idx_metrics_history_old_time ON metrics_history_old(bucket_start);
CREATE TABLE metric_history_partitions (
 role TEXT PRIMARY KEY CHECK(role IN ('current','previous')),
 week_start INTEGER NOT NULL CHECK(week_start>=0 AND (week_start+345600)%604800=0),
 schema_version INTEGER NOT NULL CHECK(schema_version=1)
) STRICT;
CREATE TABLE metric_ingest_checkpoints (
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 run_id TEXT NOT NULL CHECK(length(run_id) BETWEEN 1 AND 128),
 metric_group TEXT NOT NULL CHECK(metric_group IN ('fast','full','public_ip','legacy')),
 committed_sequence INTEGER NOT NULL CHECK(committed_sequence>0),
 sampled_at INTEGER NOT NULL CHECK(sampled_at>=0),
 PRIMARY KEY(node_id,run_id,metric_group)
) STRICT;
CREATE TABLE node_system_info (
 node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
 os_id TEXT NOT NULL CHECK(length(os_id)<=128),
 os_name TEXT NOT NULL CHECK(length(os_name)<=256),
 os_version TEXT NOT NULL CHECK(length(os_version)<=256),
 sampled_at INTEGER NOT NULL CHECK(sampled_at>=0),
 unavailable INTEGER NOT NULL CHECK(unavailable IN (0,1))
) STRICT;
CREATE TABLE node_public_addresses (
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 family INTEGER NOT NULL CHECK(family IN (4,6)),
 address TEXT NOT NULL CHECK(length(address)<=45),
 sampled_at INTEGER NOT NULL CHECK(sampled_at>=0),
 unavailable INTEGER NOT NULL CHECK(unavailable IN (0,1)),
 CHECK((unavailable=1 AND address='') OR (unavailable=0 AND address!='')),
 PRIMARY KEY(node_id,family)
) STRICT;
