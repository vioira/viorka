CREATE TABLE node_daily_traffic_generations (
 registration_at TEXT NOT NULL,
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 day_start INTEGER NOT NULL CHECK(day_start>=0),
 day_end INTEGER NOT NULL CHECK(day_end>day_start AND day_end-day_start<=93600000),
 rx_bytes INTEGER NOT NULL CHECK(rx_bytes>=0),
 tx_bytes INTEGER NOT NULL CHECK(tx_bytes>=0),
 sampled_at INTEGER NOT NULL CHECK(sampled_at>=day_start AND sampled_at<=day_end),
 revision INTEGER NOT NULL CHECK(revision>0),
 quality INTEGER NOT NULL CHECK(quality BETWEEN 0 AND 15),
 PRIMARY KEY(node_id,registration_at,day_start)
) STRICT;

INSERT INTO node_daily_traffic_generations
 (registration_at,node_id,day_start,day_end,rx_bytes,tx_bytes,sampled_at,revision,quality)
SELECT CASE WHEN d.sampled_at >= CAST(strftime('%s',n.enrollment_used_at) AS INTEGER)*1000
 THEN COALESCE(n.enrollment_used_at,'') ELSE '' END,
 d.node_id,d.day_start,d.day_end,d.rx_bytes,d.tx_bytes,d.sampled_at,d.revision,d.quality
FROM node_daily_traffic d JOIN nodes n ON n.id=d.node_id;
DROP TABLE node_daily_traffic;
ALTER TABLE node_daily_traffic_generations RENAME TO node_daily_traffic;
CREATE INDEX idx_daily_traffic_interval ON node_daily_traffic(node_id,day_start,day_end,registration_at);
