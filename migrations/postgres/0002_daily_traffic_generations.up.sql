ALTER TABLE node_daily_traffic ADD COLUMN registration_at TEXT NOT NULL DEFAULT '';
UPDATE node_daily_traffic d SET registration_at=n.enrollment_used_at FROM nodes n
WHERE n.id=d.node_id AND n.enrollment_used_at IS NOT NULL
AND d.sampled_at >= EXTRACT(EPOCH FROM n.enrollment_used_at::timestamptz)*1000;
ALTER TABLE node_daily_traffic DROP CONSTRAINT node_daily_traffic_pkey;
ALTER TABLE node_daily_traffic ADD PRIMARY KEY(node_id,registration_at,day_start);
CREATE INDEX idx_daily_traffic_interval ON node_daily_traffic(node_id,day_start,day_end,registration_at);
