CREATE TABLE relay_routes (
 id TEXT PRIMARY KEY,
 engine_id TEXT NOT NULL REFERENCES engines(id) ON DELETE CASCADE,
 landing_engine_id TEXT NOT NULL REFERENCES engines(id) ON DELETE CASCADE,
 landing_service_id TEXT NOT NULL,
 draft_version INTEGER NOT NULL CHECK(draft_version>0),
 draft_json TEXT NOT NULL,
 target_revision INTEGER NOT NULL DEFAULT 0 CHECK(target_revision>=0),
 confirmed_revision INTEGER NOT NULL DEFAULT 0 CHECK(confirmed_revision>=0),
 verify_after TEXT NOT NULL DEFAULT '',
 stopped_at TEXT NOT NULL DEFAULT '',
 deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
);
CREATE INDEX relay_routes_landing ON relay_routes(landing_engine_id,landing_service_id,id);
CREATE INDEX relay_routes_entry ON relay_routes(engine_id,id);
CREATE TABLE relay_publications (
 route_id TEXT NOT NULL REFERENCES relay_routes(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0),
 draft_version INTEGER NOT NULL CHECK(draft_version>0),
 path_json TEXT NOT NULL,
 admin_reviewed_port INTEGER NOT NULL DEFAULT 0 CHECK(admin_reviewed_port IN (0,1)),
 task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
 operation TEXT NOT NULL CHECK(operation IN ('publish','withdraw')),
 request_key TEXT NOT NULL,
 PRIMARY KEY(route_id,revision),
 UNIQUE(route_id,request_key)
);
CREATE TABLE relay_public_bindings (
 host TEXT NOT NULL,
 port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
 route_id TEXT NOT NULL REFERENCES relay_routes(id) ON DELETE CASCADE,
 PRIMARY KEY(host,port)
);
ALTER TABLE nodes ADD COLUMN relay_probe_capable INTEGER NOT NULL DEFAULT 0 CHECK(relay_probe_capable IN (0,1));
CREATE TABLE relay_probe_tasks (
 task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
 route_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 requested_by TEXT NOT NULL REFERENCES users(id),
 request_key TEXT NOT NULL,
 UNIQUE(route_id,request_key),
 FOREIGN KEY(route_id,revision) REFERENCES relay_publications(route_id,revision) ON DELETE CASCADE
);
CREATE INDEX relay_probe_tasks_route ON relay_probe_tasks(route_id,revision);

CREATE TABLE relay_public_probes (
 route_id TEXT NOT NULL,
 revision BIGINT NOT NULL,
 epoch TEXT NOT NULL,
 host TEXT NOT NULL,
 port INTEGER NOT NULL CHECK(port BETWEEN 1 AND 65535),
 requested_by TEXT NOT NULL REFERENCES users(id),
 check_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('queued','checking','passed','failed','unavailable')),
 due_at TEXT NOT NULL,
 lease_id TEXT NOT NULL DEFAULT '',
 source TEXT NOT NULL DEFAULT '',
 address TEXT NOT NULL DEFAULT '',
 detail TEXT NOT NULL DEFAULT '',
 checked_at TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(route_id,revision,epoch),
 FOREIGN KEY(route_id,revision) REFERENCES relay_publications(route_id,revision) ON DELETE CASCADE
);
CREATE INDEX relay_public_probes_due ON relay_public_probes(due_at,route_id) WHERE state IN ('queued','checking');
