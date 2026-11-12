CREATE TABLE tcp_probe_history (
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 bucket_start INTEGER NOT NULL CHECK(bucket_start>=0 AND bucket_start%60=0),
 sampled_at INTEGER NOT NULL CHECK(sampled_at>=bucket_start*1000 AND sampled_at<(bucket_start+60)*1000),
 target_1 TEXT CHECK(target_1 IS NULL OR length(target_1) BETWEEN 3 AND 259),
 ping_1 REAL CHECK(ping_1 IS NULL OR ping_1=-1 OR ping_1>=0),
 loss_1 INTEGER CHECK(loss_1 IS NULL OR (typeof(loss_1)='integer' AND loss_1 BETWEEN 0 AND 100)),
 target_2 TEXT CHECK(target_2 IS NULL OR length(target_2) BETWEEN 3 AND 259),
 ping_2 REAL CHECK(ping_2 IS NULL OR ping_2=-1 OR ping_2>=0),
 loss_2 INTEGER CHECK(loss_2 IS NULL OR (typeof(loss_2)='integer' AND loss_2 BETWEEN 0 AND 100)),
 target_3 TEXT CHECK(target_3 IS NULL OR length(target_3) BETWEEN 3 AND 259),
 ping_3 REAL CHECK(ping_3 IS NULL OR ping_3=-1 OR ping_3>=0),
 loss_3 INTEGER CHECK(loss_3 IS NULL OR (typeof(loss_3)='integer' AND loss_3 BETWEEN 0 AND 100)),
 CHECK((target_1 IS NULL AND ping_1 IS NULL AND loss_1 IS NULL) OR
       (target_1 IS NOT NULL AND ping_1 IS NOT NULL AND loss_1 IS NOT NULL AND ((ping_1=-1 AND loss_1=100) OR (ping_1>=0 AND loss_1<100)))),
 CHECK((target_2 IS NULL AND ping_2 IS NULL AND loss_2 IS NULL) OR
       (target_2 IS NOT NULL AND ping_2 IS NOT NULL AND loss_2 IS NOT NULL AND ((ping_2=-1 AND loss_2=100) OR (ping_2>=0 AND loss_2<100)))),
 CHECK((target_3 IS NULL AND ping_3 IS NULL AND loss_3 IS NULL) OR
       (target_3 IS NOT NULL AND ping_3 IS NOT NULL AND loss_3 IS NOT NULL AND ((ping_3=-1 AND loss_3=100) OR (ping_3>=0 AND loss_3<100)))),
 CHECK(target_1 IS NOT NULL),
 CHECK(target_3 IS NULL OR target_2 IS NOT NULL),
 CHECK(target_1<>target_2 AND target_1<>target_3 AND target_2<>target_3),
 PRIMARY KEY(node_id,bucket_start)
);

CREATE TABLE tcp_probe_history_old (
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 bucket_start INTEGER NOT NULL CHECK(bucket_start>=0 AND bucket_start%60=0),
 sampled_at INTEGER NOT NULL CHECK(sampled_at>=bucket_start*1000 AND sampled_at<(bucket_start+60)*1000),
 target_1 TEXT CHECK(target_1 IS NULL OR length(target_1) BETWEEN 3 AND 259),
 ping_1 REAL CHECK(ping_1 IS NULL OR ping_1=-1 OR ping_1>=0),
 loss_1 INTEGER CHECK(loss_1 IS NULL OR (typeof(loss_1)='integer' AND loss_1 BETWEEN 0 AND 100)),
 target_2 TEXT CHECK(target_2 IS NULL OR length(target_2) BETWEEN 3 AND 259),
 ping_2 REAL CHECK(ping_2 IS NULL OR ping_2=-1 OR ping_2>=0),
 loss_2 INTEGER CHECK(loss_2 IS NULL OR (typeof(loss_2)='integer' AND loss_2 BETWEEN 0 AND 100)),
 target_3 TEXT CHECK(target_3 IS NULL OR length(target_3) BETWEEN 3 AND 259),
 ping_3 REAL CHECK(ping_3 IS NULL OR ping_3=-1 OR ping_3>=0),
 loss_3 INTEGER CHECK(loss_3 IS NULL OR (typeof(loss_3)='integer' AND loss_3 BETWEEN 0 AND 100)),
 CHECK((target_1 IS NULL AND ping_1 IS NULL AND loss_1 IS NULL) OR
       (target_1 IS NOT NULL AND ping_1 IS NOT NULL AND loss_1 IS NOT NULL AND ((ping_1=-1 AND loss_1=100) OR (ping_1>=0 AND loss_1<100)))),
 CHECK((target_2 IS NULL AND ping_2 IS NULL AND loss_2 IS NULL) OR
       (target_2 IS NOT NULL AND ping_2 IS NOT NULL AND loss_2 IS NOT NULL AND ((ping_2=-1 AND loss_2=100) OR (ping_2>=0 AND loss_2<100)))),
 CHECK((target_3 IS NULL AND ping_3 IS NULL AND loss_3 IS NULL) OR
       (target_3 IS NOT NULL AND ping_3 IS NOT NULL AND loss_3 IS NOT NULL AND ((ping_3=-1 AND loss_3=100) OR (ping_3>=0 AND loss_3<100)))),
 CHECK(target_1 IS NOT NULL),
 CHECK(target_3 IS NULL OR target_2 IS NOT NULL),
 CHECK(target_1<>target_2 AND target_1<>target_3 AND target_2<>target_3),
 PRIMARY KEY(node_id,bucket_start)
);
