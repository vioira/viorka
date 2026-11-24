CREATE TABLE status_publication (
 id BIGINT PRIMARY KEY CHECK(id=1), revision BIGINT NOT NULL CHECK(revision>=1),
 enabled BIGINT NOT NULL CHECK(enabled IN (0,1)), category_revision BIGINT NOT NULL CHECK(category_revision>=1)
);
INSERT INTO status_publication VALUES(1,1,0,1);

CREATE TABLE status_nodes (
 node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
 alias TEXT NOT NULL CHECK(length(alias) BETWEEN 1 AND 96),
 position BIGINT NOT NULL UNIQUE CHECK(position>=0),
 cpu_cores BIGINT CHECK(cpu_cores BETWEEN 1 AND 65536)
);

CREATE TABLE node_categories (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('group','tag')),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 64),
 shared BIGINT NOT NULL CHECK(shared IN (0,1)), UNIQUE(kind,name), UNIQUE(id,kind)
);
CREATE TABLE node_category_members (
 node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
 category_id TEXT NOT NULL, kind TEXT NOT NULL,
 PRIMARY KEY(node_id,category_id),
 FOREIGN KEY(category_id,kind) REFERENCES node_categories(id,kind) ON DELETE CASCADE
);
CREATE UNIQUE INDEX node_single_group ON node_category_members(node_id) WHERE kind='group';

CREATE TABLE status_exchange_rates (
 id BIGINT PRIMARY KEY CHECK(id=1), fetched_day TEXT NOT NULL, quotes TEXT NOT NULL
);
