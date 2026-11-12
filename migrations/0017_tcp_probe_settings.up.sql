ALTER TABLE system_settings ADD COLUMN tcp_probe_targets TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tcp_probe_targets) AND json_type(tcp_probe_targets)='array' AND json_array_length(tcp_probe_targets)<=3);
ALTER TABLE node_telemetry_settings ADD COLUMN tcp_probe_json TEXT CHECK(tcp_probe_json IS NULL OR json_valid(tcp_probe_json));
ALTER TABLE system_settings ADD COLUMN tcp_probe_names TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tcp_probe_names) AND json_type(tcp_probe_names)='array' AND json_array_length(tcp_probe_names)<=3);
