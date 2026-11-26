package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	v1 "github.com/vioira/viorka/protocol/v1"
)

// Called under the gateway's node lock. A reset clears the task pointer only
// after excluding active sessions and unfinished tasks. Retries on the same
// identity keep that pointer, including after a restart or a failed check.
func (s *Store) queueReenrollmentCheck(ctx context.Context, tx *sql.Tx, node string) (bool, error) {
	var id, actor, name, intent, arch string
	var revision, draftVersion int64
	err := tx.QueryRowContext(ctx, `SELECT e.id,r.requested_by,e.name,e.run_intent,e.desired_revision,coalesce(d.version,0),n.arch
 FROM subscription_restore_engines r JOIN engines e ON e.id=r.engine_id JOIN nodes n ON n.id=e.node_id
 LEFT JOIN engine_drafts d ON d.engine_id=e.id
 WHERE e.node_id=? AND n.state='online' AND n.os='linux' AND n.engine_capable=1 AND r.reason!='restore'
 AND r.state='pending' AND r.task_id='' AND NOT EXISTS(SELECT 1 FROM engine_operations o WHERE o.engine_id=e.id AND o.active=1)
 ORDER BY e.id LIMIT 1`, node).Scan(&id, &actor, &name, &intent, &revision, &draftVersion, &arch)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err = engineAccess(ctx, tx, actor, node, true); errors.Is(err, proxy.ErrForbidden) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	version := v1.EngineVersion(name)
	if _, ok := v1.EngineReleaseFor(name, version, arch); !ok {
		return false, nil
	}
	action := EngineAction{Operation: "engine.inspect", RecoveryCheck: true, Confirm: true, IdempotencyKey: auth.Random(), Version: version, DraftVersion: draftVersion}
	raw, err := json.Marshal(action)
	if err != nil {
		return false, err
	}
	command := v1.EngineCommand{Name: name, Version: version, RunIntent: intent, Revision: uint64(revision + 1), Services: []*v1.EngineService{}, RecoveryCheck: true}
	_, err = s.queueEngineOperation(ctx, tx, actor, node, id, action, command, proxy.Draft{Version: draftVersion}, nil, raw)
	return err == nil, err
}

// A key change can preserve the live deployment exactly. Keep the published
// draft (including preset and endpoint metadata) when the checked command
// matches it. An unexpected or pending configuration requires explicit review.
func (s *Store) confirmReenrolledEngine(ctx context.Context, tx *sql.Tx, id string, snapshot *v1.EngineRecovery) error {
	target, err := s.readTarget(ctx, tx, id)
	command := snapshot.Command
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if len(command.Services) > 0 || len(command.Outbounds) > 0 || command.Routing != nil {
			return nil
		}
	case err != nil:
		return err
	default:
		if target.Revision != int64(command.Revision) || canonicalCommand(target.Command) != canonicalCommand(*command) {
			return nil
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE engines SET version=?,run_intent=?,observed_revision=?,desired_revision=max(desired_revision,?) WHERE id=?`, command.Version, command.RunIntent, command.Revision, command.Revision, id); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `DELETE FROM subscription_restore_engines WHERE engine_id=? AND reason='reenrollment'`, id)
	return err
}
