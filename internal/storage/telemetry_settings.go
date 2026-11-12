package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

// TelemetrySettings stores versioned desired telemetry settings. Absent rows
// represent the v3 defaults.
func (s *Store) TelemetrySettings(ctx context.Context, node string) (v1.TelemetrySettings, error) {
	v := v1.DefaultTelemetrySettings()
	var revision, c, r, w sql.NullInt64
	var mode, level, traffic, probe sql.NullString
	var global string
	err := s.db.QueryRowContext(ctx, `SELECT t.revision,t.collection_seconds,t.http_report_seconds,t.wss_report_seconds,t.connection_mode,t.log_level,t.traffic_json,t.tcp_probe_json,COALESCE((SELECT tcp_probe_targets FROM system_settings WHERE id=1),'[]') FROM nodes n LEFT JOIN node_telemetry_settings t ON t.node_id=n.id WHERE n.id=?`, node).Scan(&revision, &c, &r, &w, &mode, &level, &traffic, &probe, &global)
	if errors.Is(err, sql.ErrNoRows) {
		return v, auth.ErrNotFound
	}
	if err != nil {
		return v, err
	}
	if revision.Valid {
		v = v1.TelemetrySettings{Revision: uint64(revision.Int64), CollectionSeconds: uint64(c.Int64), HttpReportSeconds: uint64(r.Int64), WssReportSeconds: uint64(w.Int64), ConnectionMode: mode.String, LogLevel: level.String}
	}
	if traffic.Valid {
		if err = json.Unmarshal([]byte(traffic.String), &v.Traffic); err != nil {
			return v, err
		}
	}
	if probe.Valid {
		if err = json.Unmarshal([]byte(probe.String), &v.TcpProbe); err != nil {
			return v, err
		}
	} else {
		var targets []string
		if err = json.Unmarshal([]byte(global), &targets); err != nil {
			return v, err
		}
		if len(targets) > 0 {
			v.TcpProbe = &v1.TelemetryTCPProbeSettings{Targets: targets, UseGlobal: true}
		}
	}
	return v, v.Validate()
}
func (s *Store) SaveTelemetrySettings(ctx context.Context, actor, node string, v v1.TelemetrySettings) (v1.TelemetrySettings, error) {
	if v.LogLevel == "" {
		v.LogLevel = "warn"
	}
	if v.Validate() != nil || v.Revision == math.MaxInt64 {
		return v, auth.ErrInvalid
	}
	var probe any
	if v.TcpProbe != nil && !v.TcpProbe.UseGlobal {
		raw, err := json.Marshal(v.TcpProbe)
		if err != nil {
			return v, err
		}
		probe = string(raw)
	}
	rawTraffic, err := json.Marshal(v.Traffic)
	if err != nil {
		return v, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return v, err
	}
	defer tx.Rollback()
	var revision uint64
	err = tx.QueryRowContext(ctx, `SELECT COALESCE(t.revision,1) FROM nodes n LEFT JOIN node_telemetry_settings t ON t.node_id=n.id WHERE n.id=?`, node).Scan(&revision)
	if errors.Is(err, sql.ErrNoRows) {
		return v, auth.ErrNotFound
	}
	if err != nil {
		return v, err
	}
	if revision != v.Revision {
		return v, auth.ErrConflict
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO node_telemetry_settings(node_id,revision,collection_seconds,http_report_seconds,wss_report_seconds,connection_mode,log_level,traffic_json,tcp_probe_json) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET revision=excluded.revision,collection_seconds=excluded.collection_seconds,http_report_seconds=excluded.http_report_seconds,wss_report_seconds=excluded.wss_report_seconds,connection_mode=excluded.connection_mode,log_level=excluded.log_level,traffic_json=excluded.traffic_json,tcp_probe_json=excluded.tcp_probe_json,result_json=NULL`, node, v.Revision+1, v.CollectionSeconds, v.HttpReportSeconds, v.WssReportSeconds, v.ConnectionMode, v.LogLevel, string(rawTraffic), probe)
	if err != nil {
		return v, err
	}
	if err = audit(ctx, tx, actor, "node.telemetry_settings.update", "node", node); err != nil {
		return v, err
	}
	if err = s.commitChanges(tx, realtime.Change{Kind: "telemetry_settings", NodeID: node, Revision: v.Revision + 1}); err != nil {
		return v, err
	}
	return s.TelemetrySettings(ctx, node)
}
func (s *Store) RecordTelemetrySettingsResult(ctx context.Context, node string, result v1.TelemetrySettingsResult) error {
	if result.Validate() != nil {
		return auth.ErrInvalid
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Materialize defaults only for an existing node; deletion cannot resurrect it.
	defaults := v1.DefaultTelemetrySettings()
	_, err = tx.ExecContext(ctx, `INSERT INTO node_telemetry_settings(node_id,revision,collection_seconds,http_report_seconds,wss_report_seconds,connection_mode) SELECT id,?,?,?,?,? FROM nodes WHERE id=? ON CONFLICT(node_id) DO NOTHING`, defaults.Revision, defaults.CollectionSeconds, defaults.HttpReportSeconds, defaults.WssReportSeconds, defaults.ConnectionMode, node)
	if err != nil {
		return err
	}
	changed, err := tx.ExecContext(ctx, `UPDATE node_telemetry_settings SET result_json=? WHERE node_id=? AND revision=? AND (result_json IS NULL OR json_extract(result_json,'$.state')!='applied')`, string(raw), node, result.Revision)
	if err != nil {
		return err
	}
	n, err := changed.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	return s.commitChanges(tx, realtime.Change{Kind: "telemetry_settings_result", NodeID: node})
}
func (s *Store) TelemetrySettingsResult(ctx context.Context, node string) (*v1.TelemetrySettingsResult, error) {
	var raw sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT t.result_json FROM nodes n LEFT JOIN node_telemetry_settings t ON t.node_id=n.id WHERE n.id=?`, node).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, auth.ErrNotFound
	}
	if err != nil || !raw.Valid {
		return nil, err
	}
	var result v1.TelemetrySettingsResult
	if err = json.Unmarshal([]byte(raw.String), &result); err != nil {
		return nil, err
	}
	return &result, result.Validate()
}
