CREATE TABLE node_daily_traffic (
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 day_start INTEGER NOT NULL CHECK(day_start>=0),
 day_end INTEGER NOT NULL CHECK(day_end>day_start AND day_end-day_start<=93600000),
 rx_bytes INTEGER NOT NULL CHECK(rx_bytes>=0),
 tx_bytes INTEGER NOT NULL CHECK(tx_bytes>=0),
 sampled_at INTEGER NOT NULL CHECK(sampled_at>=day_start AND sampled_at<=day_end),
 revision INTEGER NOT NULL CHECK(revision>0),
 quality INTEGER NOT NULL CHECK(quality BETWEEN 0 AND 15),
 PRIMARY KEY(node_id,day_start)
) STRICT;
