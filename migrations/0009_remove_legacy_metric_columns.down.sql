-- Restore the previous schema only; discarded legacy values cannot be recovered.
ALTER TABLE metric_rollups ADD COLUMN cpu_avg REAL;
ALTER TABLE metric_rollups ADD COLUMN memory_used_bytes INTEGER;
ALTER TABLE metric_rollups ADD COLUMN rx_bytes INTEGER;
ALTER TABLE metric_rollups ADD COLUMN tx_bytes INTEGER;
