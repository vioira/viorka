package storage

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/realtime"
	"github.com/vioira/viorka/internal/scheduler"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type EngineAction = proxy.Action
type engineCredential struct {
	UUID       string   `json:"uuid"`
	PrivateKey string   `json:"private_key"`
	ShortIDs   []string `json:"short_ids"`
}

func newEngineCredential(shortIDs []string) (engineCredential, error) {
	key, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return engineCredential{}, err
	}
	b := make([]byte, 16)
	if _, err = rand.Read(b); err != nil {
		return engineCredential{}, err
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	if len(shortIDs) == 0 {
		short := make([]byte, 8)
		if _, err = rand.Read(short); err != nil {
			return engineCredential{}, err
		}
		shortIDs = []string{hex.EncodeToString(short)}
	}
	return engineCredential{UUID: fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:]), PrivateKey: base64.RawURLEncoding.EncodeToString(key.Bytes()), ShortIDs: shortIDs}, nil
}
func (s *Store) InstallEngine(ctx context.Context, actor, node, name string, a EngineAction) (scheduler.Task, error) {
	if !proxy.ValidEngine(name) || a.Operation != "engine.install" {
		return scheduler.Task{}, proxy.ErrInvalid
	}
	return s.engineAction(ctx, actor, node, name, "", a)
}
func (s *Store) EngineAction(ctx context.Context, actor, id string, a EngineAction) (scheduler.Task, error) {
	return s.engineAction(ctx, actor, "", "", id, a)
}
func (s *Store) engineAction(ctx context.Context, actor, node, name, id string, a EngineAction) (scheduler.Task, error) {
	if a.DeleteServices && a.Operation != "engine.uninstall" || !v1.EngineOperation(a.Operation) || len(a.IdempotencyKey) < 1 || len(a.IdempotencyKey) > 128 || !a.Confirm || a.DraftVersion < 0 {
		return scheduler.Task{}, proxy.ErrInvalid
	}
	requestJSON, _ := json.Marshal(a)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return scheduler.Task{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE nodes SET state=state WHERE id=? OR id=(SELECT node_id FROM engines WHERE id=?)`, node, id); err != nil {
		return scheduler.Task{}, err
	}
	if id != "" {
		if err = tx.QueryRowContext(ctx, `SELECT node_id,name FROM engines WHERE id=?`, id).Scan(&node, &name); errors.Is(err, sql.ErrNoRows) {
			return scheduler.Task{}, auth.ErrNotFound
		} else if err != nil {
			return scheduler.Task{}, err
		}
	}
	if err = engineAccess(ctx, tx, actor, node, true); err != nil {
		return scheduler.Task{}, err
	}
	if a.Operation == "engine.install" || a.Operation == "engine.upgrade" || a.Operation == "engine.uninstall" {
		var role string
		if err = tx.QueryRowContext(ctx, `SELECT role FROM users WHERE id=?`, actor).Scan(&role); err != nil {
			return scheduler.Task{}, err
		}
		if role != "admin" {
			return scheduler.Task{}, proxy.ErrForbidden
		}
	}
	var state, osName, arch string
	var capable bool
	if err = tx.QueryRowContext(ctx, `SELECT state,coalesce(os,''),coalesce(arch,''),engine_capable FROM nodes WHERE id=?`, node).Scan(&state, &osName, &arch, &capable); errors.Is(err, sql.ErrNoRows) {
		return scheduler.Task{}, auth.ErrNotFound
	} else if err != nil {
		return scheduler.Task{}, err
	}
	if state != "online" || !capable || osName != "linux" {
		return scheduler.Task{}, proxy.ErrUnavailable
	}
	if a.Version == "" {
		a.Version = v1.EngineVersion(name)
	}
	if _, ok := v1.EngineReleaseFor(name, a.Version, arch); !ok {
		return scheduler.Task{}, proxy.ErrUnavailable
	}
	if id == "" {
		id = auth.Random()
		_, err = tx.ExecContext(ctx, `INSERT INTO engines(id,node_id,name,ownership,status) VALUES(?,?,?,'managed','not_installed') ON CONFLICT(node_id,name) DO NOTHING`, id, node, name)
		if err != nil {
			return scheduler.Task{}, err
		}
		if err = tx.QueryRowContext(ctx, `SELECT id FROM engines WHERE node_id=? AND name=?`, node, name).Scan(&id); err != nil {
			return scheduler.Task{}, err
		}
	}
	// The same request key is only reusable for the exact same resource and intent.
	var previous, previousEngine, previousRequest string
	var priorOperation string
	var priorDraft int64
	err = tx.QueryRowContext(ctx, `SELECT t.id,o.operation,o.draft_version,o.engine_id,o.request_json FROM tasks t JOIN engine_operations o ON o.task_id=t.id WHERE t.node_id=? AND t.idempotency_key=? `, node, a.IdempotencyKey).Scan(&previous, &priorOperation, &priorDraft, &previousEngine, &previousRequest)
	if err == nil {
		if previousEngine != id || previousRequest != string(requestJSON) || priorOperation != a.Operation || priorDraft != a.DraftVersion {
			return scheduler.Task{}, proxy.ErrConflict
		}
		tx.Rollback()
		return s.Task(ctx, previous)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return scheduler.Task{}, err
	}
	e, err := scanEngine(tx.QueryRowContext(ctx, `SELECT `+engineColumns+` FROM engines e LEFT JOIN engine_drafts d ON d.engine_id=e.id WHERE e.id=?`, id))
	if err != nil {
		return scheduler.Task{}, err
	}
	if e.Ownership != "managed" {
		return scheduler.Task{}, proxy.ErrConflict
	}
	var active bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM engine_operations WHERE engine_id=? AND active=1)`, id).Scan(&active); err != nil {
		return scheduler.Task{}, err
	}
	if active {
		return scheduler.Task{}, proxy.ErrConflict
	}
	if a.Operation != "engine.install" && a.Operation != "engine.inspect" && (e.Status == "not_installed" || e.Status == "unknown" || e.Status == "degraded") {
		return scheduler.Task{}, proxy.ErrConflict
	}
	if a.Operation == "engine.install" && e.Status != "not_installed" {
		return scheduler.Task{}, proxy.ErrConflict
	}
	if a.Operation == "engine.uninstall" && a.DraftVersion != e.Draft.Version {
		return scheduler.Task{}, proxy.ErrConflict
	}
	if a.Operation != "engine.apply" && a.Operation != "engine.inspect" && a.Operation != "engine.start" && a.Operation != "engine.stop" {
		var pending bool
		if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM engine_targets WHERE engine_id=? AND revision>?)`, id, e.ObservedRevision).Scan(&pending); err != nil {
			return scheduler.Task{}, err
		}
		if pending {
			return scheduler.Task{}, proxy.ErrConflict
		}
	}
	cmd := v1.EngineCommand{Name: name, Version: a.Version, Revision: uint64(e.DesiredRevision + 1), RunIntent: e.RunIntent, AllowUnreachable: a.AllowUnreachable, Services: []*v1.EngineService{}}
	if a.Operation == "engine.start" {
		cmd.RunIntent = "running"
	}
	if a.Operation == "engine.stop" {
		cmd.RunIntent = "stopped"
	}
	credentials := map[string]engineCredential{}
	var encrypted string
	if err = tx.QueryRowContext(ctx, `SELECT encrypted FROM engine_credentials WHERE engine_id=?`, id).Scan(&encrypted); err == nil {
		b, err := s.openEngine(id, encrypted)
		if err != nil {
			return scheduler.Task{}, err
		}
		if err = json.Unmarshal(b, &credentials); err != nil {
			return scheduler.Task{}, err
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return scheduler.Task{}, err
	}
	if a.Operation != "engine.apply" && (a.RestorePrevious || a.RotateServiceID != "") {
		return scheduler.Task{}, proxy.ErrInvalid
	}
	if a.Operation == "engine.apply" {
		if a.RestorePrevious {
			var history string
			err = tx.QueryRowContext(ctx, `SELECT o.public_snapshot FROM engine_operations o JOIN tasks t ON t.id=o.task_id WHERE o.engine_id=? AND o.operation='engine.apply' AND t.state='succeeded' ORDER BY o.revision DESC LIMIT 1 OFFSET 1`, id).Scan(&history)
			if errors.Is(err, sql.ErrNoRows) {
				return scheduler.Task{}, proxy.ErrConflict
			}
			if err != nil {
				return scheduler.Task{}, err
			}
			var restored proxy.Draft
			if err = json.Unmarshal([]byte(history), &restored); err != nil {
				return scheduler.Task{}, err
			}
			// Restore only services still present; deleted or credential-less identities cannot resurrect.
			present := map[string]bool{}
			for _, service := range e.Draft.Services {
				present[service.ID] = true
			}
			for _, service := range restored.Services {
				if !present[service.ID] {
					return scheduler.Task{}, proxy.ErrConflict
				}
			}
			e.Draft.Services = restored.Services
			e.Draft.Routing = restored.Routing
		}
		if err = s.resolveOutbounds(ctx, tx, e.Draft, &cmd); err != nil {
			return scheduler.Task{}, err
		}
		rotated := a.RotateServiceID == ""

		if e.Draft.Version != a.DraftVersion {
			return scheduler.Task{}, proxy.ErrConflict
		}
		if err = proxy.ValidateDraft(name, e.Draft); err != nil {
			return scheduler.Task{}, err
		}
		for i, v := range e.Draft.Services {
			if v.PendingDelete {
				continue
			}
			cred := credentials[v.ID]
			var shortIDs []string
			if v.PresetID != "" {
				p, err := scanPreset(tx.QueryRowContext(ctx, `SELECT id,config_json,created_at FROM protocol_presets WHERE id=?`, v.PresetID))
				if err != nil {
					return scheduler.Task{}, err
				}
				if !p.Referenceable || name == "realm" {
					return scheduler.Task{}, proxy.ErrPresetUnsupported
				}
				shortIDs = p.Config.ShortIDs
				v = proxy.ResolvePreset(v, p.Config)
				e.Draft.Services[i] = v
			}
			if v.ID == a.RotateServiceID {
				if name == "realm" {
					return scheduler.Task{}, proxy.ErrInvalid
				}
				cred = engineCredential{}
				rotated = true
			}
			if name != "realm" && cred.UUID == "" {
				cred, err = newEngineCredential(shortIDs)
				if err != nil {
					return scheduler.Task{}, err
				}
			}
			if len(shortIDs) > 0 {
				cred.ShortIDs = shortIDs
			}
			credentials[v.ID] = cred
			cmd.Services = append(cmd.Services, &v1.EngineService{ID: v.ID, Name: v.Name, Enabled: v.Enabled, ListenHost: v.ListenHost, ListenPort: uint64(v.ListenPort), TargetHost: v.TargetHost, TargetPort: uint64(v.TargetPort), ServerName: v.ServerName, Uuid: cred.UUID, PrivateKey: cred.PrivateKey, ShortIds: append([]string{}, cred.ShortIDs...)})
		}
		if err = proxy.ValidateDraft(name, e.Draft); err != nil {
			return scheduler.Task{}, err
		}
		if !rotated {
			return scheduler.Task{}, proxy.ErrInvalid
		}
	}
	if a.Operation == "engine.apply" {
		target := engineTarget{ID: id, Node: node, Actor: actor, Revision: int64(cmd.Revision), Command: cmd, Draft: e.Draft, Credentials: credentials}
		target.Draft.Services = []proxy.Service{}
		for _, v := range e.Draft.Services {
			if !v.PendingDelete {
				target.Draft.Services = append(target.Draft.Services, v)
			}
		}
		previous, readErr := s.readTarget(ctx, tx, id)
		if readErr != nil && !errors.Is(readErr, sql.ErrNoRows) {
			return scheduler.Task{}, readErr
		}
		// Public endpoints are Panel metadata, absent from the wire command.
		// Only skip dispatch when the same target is already confirmed healthy.
		if !a.RestorePrevious && a.RotateServiceID == "" && readErr == nil && previous.Error == "" && previous.Revision <= e.ObservedRevision && canonicalCommand(previous.Command) == canonicalCommand(cmd) {
			metadata, marshalErr := json.Marshal(target.Draft)
			if marshalErr != nil {
				return scheduler.Task{}, marshalErr
			}
			if _, err = tx.ExecContext(ctx, `UPDATE engine_targets SET public_snapshot=?,updated_by=? WHERE engine_id=?`, string(metadata), actor, id); err != nil {
				return scheduler.Task{}, err
			}
			if err = audit(ctx, tx, actor, "engine.metadata.apply", "engine", id); err != nil {
				return scheduler.Task{}, err
			}
			return scheduler.Task{}, s.commitChanges(tx, realtime.Change{Kind: "node", NodeID: node}, realtime.Change{Kind: "engines", NodeID: node, EngineID: id})
		}
		if err = checkTargetPorts(ctx, tx, target); err != nil {
			return scheduler.Task{}, err
		}
		if err = reserveTarget(ctx, tx, target); err != nil {
			return scheduler.Task{}, err
		}
		if err = s.writeTarget(ctx, tx, target, false); err != nil {
			return scheduler.Task{}, err
		}
	}
	if a.Operation == "engine.start" || a.Operation == "engine.stop" {
		target, readErr := s.readTarget(ctx, tx, id)
		if readErr != nil && !errors.Is(readErr, sql.ErrNoRows) {
			return scheduler.Task{}, readErr
		}
		if readErr == nil && target.Revision > e.ObservedRevision {
			target.Command.RunIntent = cmd.RunIntent
			target.Revision = int64(cmd.Revision) + 1
			target.Actor = actor
			if err = s.writeTarget(ctx, tx, target, true); err != nil {
				return scheduler.Task{}, err
			}
		}
	}
	if err = cmd.Validate(a.Operation); err != nil {
		return scheduler.Task{}, proxy.ErrInvalid
	}
	payload, err := json.Marshal(cmd)
	if err != nil {
		return scheduler.Task{}, err
	}
	sealed, err := s.sealEngine(id, payload)
	if err != nil {
		return scheduler.Task{}, err
	}
	creds, err := json.Marshal(credentials)
	if err != nil {
		return scheduler.Task{}, err
	}
	sealedCreds, err := s.sealEngine(id, creds)
	if err != nil {
		return scheduler.Task{}, err
	}
	snapshot, err := json.Marshal(e.Draft)
	if err != nil {
		return scheduler.Task{}, err
	}
	taskID := auth.Random()
	hash := sha256.Sum256(payload)
	if _, err = tx.ExecContext(ctx, `INSERT INTO config_revisions(id,node_id,resource_kind,resource_id,revision,sha256,desired_json,created_by,created_at) VALUES(?,?,'engine',?,?,?,?,?,?)`, auth.Random(), node, id, cmd.Revision, hex.EncodeToString(hash[:]), sealed, actor, now()); err != nil {
		return scheduler.Task{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO tasks(id,node_id,task_type,idempotency_key,revision,state,payload_json,created_at,updated_at,deadline_at,max_attempts) VALUES(?,?,?,?,?,'queued','{}',?,?,?,10)`, taskID, node, a.Operation, a.IdempotencyKey, cmd.Revision, now(), now(), at(time.Now().Add(5*time.Minute))); err != nil {
		return scheduler.Task{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO engine_operations(task_id,engine_id,draft_version,command_encrypted,public_snapshot,credential_encrypted,operation,revision,request_json) VALUES(?,?,?,?,?,?,?,?,?)`, taskID, id, e.Draft.Version, sealed, string(snapshot), sealedCreds, a.Operation, cmd.Revision, string(requestJSON)); err != nil {
		return scheduler.Task{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE engines SET desired_revision=max(desired_revision,?) WHERE id=?`, cmd.Revision, id); err != nil {
		return scheduler.Task{}, err
	}
	if err = audit(ctx, tx, actor, a.Operation, "engine", id); err != nil {
		return scheduler.Task{}, err
	}
	if err = s.commitChanges(tx, realtime.Change{Kind: "tasks", NodeID: node, TaskID: taskID}, realtime.Change{Kind: "engines", NodeID: node, EngineID: id}); err != nil {
		return scheduler.Task{}, err
	}
	return s.Task(ctx, taskID)
}
