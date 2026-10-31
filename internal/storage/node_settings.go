package storage

import (
	"context"
	"database/sql"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func (s *Store) NodeSettings(ctx context.Context, id string) (v1.NodeSettings, error) {
	var v v1.NodeSettings
	err := s.db.QueryRowContext(ctx, `SELECT settings_revision,collection_seconds,report_seconds,connection_mode,wss_report_seconds FROM nodes WHERE id=?`, id).Scan(&v.Revision, &v.CollectionSeconds, &v.ReportSeconds, &v.ConnectionMode, &v.WssReportSeconds)
	if errors.Is(err, sql.ErrNoRows) {
		err = auth.ErrNotFound
	}
	return v, err
}
func (s *Store) SaveNodeSettings(ctx context.Context, actor, id string, v v1.NodeSettings) (v1.NodeSettings, error) {
	if v.Validate() != nil {
		return v, auth.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return v, err
	}
	defer tx.Rollback()
	var revision uint64
	if err = tx.QueryRowContext(ctx, `SELECT settings_revision FROM nodes WHERE id=?`, id).Scan(&revision); errors.Is(err, sql.ErrNoRows) {
		return v, auth.ErrNotFound
	} else if err != nil {
		return v, err
	}
	if revision != v.Revision {
		return v, auth.ErrConflict
	}
	result, err := tx.ExecContext(ctx, `UPDATE nodes SET settings_revision=settings_revision+1,collection_seconds=?,report_seconds=?,connection_mode=?,wss_report_seconds=? WHERE id=? AND settings_revision=?`, v.CollectionSeconds, v.ReportSeconds, v.ConnectionMode, v.WssReportSeconds, id, v.Revision)
	if err != nil {
		return v, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return v, err
	}
	if n != 1 {
		return v, auth.ErrConflict
	}
	if err = audit(ctx, tx, actor, "node.settings.update", "node", id); err != nil {
		return v, err
	}
	err = tx.Commit()
	if err == nil {
		v.Revision++
	}
	return v, err
}
