package storage

import (
	"database/sql"
	"github.com/vioira/viorka/internal/realtime"
)

func (s *Store) Events() *realtime.Hub { return s.events }

// Only publish after the transaction is visible to readers. These are bounded
// invalidations, not an audit journal or a delivery guarantee.
func (s *Store) commitChanges(tx *sql.Tx, changes ...realtime.Change) error {
	if err := tx.Commit(); err != nil {
		return err
	}
	for _, change := range changes {
		s.events.Publish(change)
	}
	return nil
}
