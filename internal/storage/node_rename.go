package storage

import (
	"context"
	"database/sql"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/realtime"
)

func (s *Store) RenameNode(ctx context.Context, actor, id, name, expected string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `UPDATE nodes SET name=? WHERE id=? AND name=?`, name, id, expected)
	if err != nil {
		return err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		var current string
		err = tx.QueryRowContext(ctx, `SELECT name FROM nodes WHERE id=?`, id).Scan(&current)
		if errors.Is(err, sql.ErrNoRows) {
			return auth.ErrNotFound
		}
		if err != nil {
			return err
		}
		// Permit retry after a lost successful response without overwriting a newer name.
		if current == name {
			return tx.Commit()
		}
		return auth.ErrConflict
	}
	if err = audit(ctx, tx, actor, "node.rename", "node", id); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "node", NodeID: id})
}
