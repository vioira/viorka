package storage

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/netip"
	"sort"
	"strings"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func (s *Store) ProtocolPreset(ctx context.Context, actor, id string) (proxy.PresetDetail, error) {
	if err := presetAccess(ctx, s.db, actor, false); err != nil {
		return proxy.PresetDetail{}, err
	}
	p, err := scanPreset(s.db.QueryRowContext(ctx, `SELECT id,config_json,created_at FROM protocol_presets WHERE id=?`, id))
	return proxy.PresetDetail{Preset: p, Digest: digestJSON(p.Config)}, err
}

// No protocol version is stored. The digest is only an edit concurrency fence.
func (s *Store) PreviewProtocolPreset(ctx context.Context, actor, id string, edit proxy.PresetEdit) (proxy.PresetPreview, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return proxy.PresetPreview{}, err
	}
	defer tx.Rollback()
	preview, _, err := s.previewPreset(ctx, tx, actor, id, edit)
	return preview, err
}

func canonicalCommand(c v1.EngineCommand) string {
	c.Revision = 0
	c.Services = append([]*v1.EngineService{}, c.Services...)
	for i, service := range c.Services {
		normalized := *service
		normalized.ServerName = strings.ToLower(normalized.ServerName)
		normalized.TargetHost = strings.ToLower(normalized.TargetHost)
		if addr, err := netip.ParseAddr(normalized.ListenHost); err == nil {
			normalized.ListenHost = addr.String()
		}
		if addr, err := netip.ParseAddr(normalized.TargetHost); err == nil {
			normalized.TargetHost = addr.String()
		}
		normalized.ShortIds = append([]string{}, service.ShortIds...)
		for j := range normalized.ShortIds {
			normalized.ShortIds[j] = strings.ToLower(normalized.ShortIds[j])
		}
		c.Services[i] = &normalized
	}
	sort.Slice(c.Services, func(i, j int) bool { return c.Services[i].ID < c.Services[j].ID })
	return digestJSON(c)
}

type presetReference struct {
	id, node, name, state, engine, intent, status, draft string
	revision, draftVersion                               int64
}

func (s *Store) previewPreset(ctx context.Context, tx *sql.Tx, actor, id string, edit proxy.PresetEdit) (proxy.PresetPreview, []engineTarget, error) {
	preview := proxy.PresetPreview{Impacts: []proxy.PresetImpact{}}
	if err := presetAccess(ctx, tx, actor, true); err != nil {
		return preview, nil, err
	}
	p, err := scanPreset(tx.QueryRowContext(ctx, `SELECT id,config_json,created_at FROM protocol_presets WHERE id=?`, id))
	if err != nil {
		return preview, nil, err
	}
	if edit.BaseDigest != digestJSON(p.Config) {
		return preview, nil, proxy.ErrPresetStale
	}
	c := edit.Config
	// Clearing Short IDs in an edit preserves the current identity; creation alone generates them.
	if c.Security == "reality" && len(c.ShortIDs) == 0 {
		c.ShortIDs = append([]string{}, p.Config.ShortIDs...)
	}
	if c.ShortIDs == nil {
		c.ShortIDs = []string{}
	}
	for i := range c.ShortIDs {
		c.ShortIDs[i] = strings.ToLower(c.ShortIDs[i])
	}
	if err = proxy.ValidatePreset(c); err != nil {
		return preview, nil, err
	}
	var duplicate bool
	if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM protocol_presets WHERE name=? AND id!=?)`, c.Name, id).Scan(&duplicate); err != nil {
		return preview, nil, err
	}
	if duplicate {
		return preview, nil, proxy.ErrConflict
	}
	preview.Before = p.Config
	preview.Config = c
	// Bound the atomic batch. Never silently truncate a confirmation scope.
	rows, err := tx.QueryContext(ctx, `SELECT e.id,e.node_id,n.name,n.state,e.name,e.run_intent,e.status,e.desired_revision,coalesce(d.services_json,'[]'),coalesce(d.version,0) FROM engines e JOIN nodes n ON n.id=e.node_id LEFT JOIN engine_drafts d ON d.engine_id=e.id LEFT JOIN engine_targets t ON t.engine_id=e.id WHERE EXISTS(SELECT 1 FROM json_each(d.services_json) j WHERE json_extract(j.value,'$.preset_id')=?) OR EXISTS(SELECT 1 FROM json_each(t.public_snapshot,'$.services') j WHERE json_extract(j.value,'$.preset_id')=?) ORDER BY e.node_id,e.id LIMIT 501`, id, id)
	if err != nil {
		return preview, nil, err
	}
	refs := []presetReference{}
	for rows.Next() {
		var r presetReference
		if err = rows.Scan(&r.id, &r.node, &r.name, &r.state, &r.engine, &r.intent, &r.status, &r.revision, &r.draft, &r.draftVersion); err != nil {
			break
		}
		refs = append(refs, r)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return preview, nil, err
	}
	if len(refs) > 500 {
		return preview, nil, proxy.ErrPresetLimit
	}
	targets := []engineTarget{}
	fence := []string{actor, id, edit.BaseDigest, digestJSON(c)}
	for _, r := range refs {
		if err = engineAccess(ctx, tx, actor, r.node, true); err != nil {
			return preview, nil, err
		}
		impact := proxy.PresetImpact{EngineID: r.id, NodeID: r.node, NodeName: r.name, NodeState: r.state, Engine: r.engine, RunIntent: r.intent, Services: []proxy.PresetServiceImpact{}, SharedServices: []string{}}
		fence = append(fence, digestJSON([]any{r.id, r.node, r.name, r.state, r.engine, r.intent, r.status, r.revision, r.draft, r.draftVersion}))
		t, readErr := s.readTarget(ctx, tx, r.id)
		if readErr != nil && !errors.Is(readErr, sql.ErrNoRows) {
			return preview, nil, readErr
		}
		var draft proxy.Draft
		if err = json.Unmarshal([]byte(r.draft), &draft.Services); err != nil {
			return preview, nil, err
		}
		if errors.Is(readErr, sql.ErrNoRows) {
			impact.DraftOnly = true
			t.Draft = draft
		} else {
			fence = append(fence, digestJSON(t.Draft), canonicalCommand(t.Command), t.Error)
		}
		// A concurrently executing stop/upgrade has already been authorized.
		// Carry its intent into the next full configuration, never restart a stopped engine.
		var activeCommand string
		activeErr := tx.QueryRowContext(ctx, `SELECT command_encrypted FROM engine_operations WHERE engine_id=? AND active=1 AND operation NOT IN ('engine.apply','engine.inspect')`, r.id).Scan(&activeCommand)
		if activeErr != nil && !errors.Is(activeErr, sql.ErrNoRows) {
			return preview, nil, activeErr
		}
		if activeErr == nil {
			data, err := s.openEngine(r.id, activeCommand)
			if err != nil {
				return preview, nil, err
			}
			var active v1.EngineCommand
			if err = json.Unmarshal(data, &active); err != nil {
				return preview, nil, err
			}
			t.Command.RunIntent = active.RunIntent
			t.Command.Version = active.Version
			impact.RunIntent = active.RunIntent
			fence = append(fence, digestJSON(active))
		}
		beforeCommand := canonicalCommand(t.Command)
		referenced := false
		for i, service := range t.Draft.Services {
			impact.SharedServices = append(impact.SharedServices, service.Name)
			if service.PresetID != id {
				continue
			}
			referenced = true
			next := proxy.ResolvePreset(service, c)
			impact.Services = append(impact.Services, proxy.PresetServiceImpact{ID: service.ID, Name: service.Name, PortOverridden: service.PortOverride != nil, SNIOverridden: service.SNIOverride != nil, BeforePort: service.ListenPort, AfterPort: next.ListenPort, BeforeSNI: service.ServerName, AfterSNI: next.ServerName})
			t.Draft.Services[i] = next
			if impact.DraftOnly {
				continue
			}
			for _, commandService := range t.Command.Services {
				if commandService.ID != service.ID {
					continue
				}
				commandService.ListenPort = uint64(next.ListenPort)
				commandService.ServerName = next.ServerName
				commandService.TargetHost = next.TargetHost
				commandService.TargetPort = uint64(next.TargetPort)
				commandService.ShortIds = append([]string{}, c.ShortIDs...)
				credential := t.Credentials[service.ID]
				credential.ShortIDs = append([]string{}, c.ShortIDs...)
				t.Credentials[service.ID] = credential
			}
		}
		// A preset can be referenced solely by edits not yet published.
		if !referenced {
			impact.DraftOnly = true
			for _, service := range draft.Services {
				if service.PresetID == id {
					next := proxy.ResolvePreset(service, c)
					impact.Services = append(impact.Services, proxy.PresetServiceImpact{ID: service.ID, Name: service.Name, PortOverridden: service.PortOverride != nil, SNIOverridden: service.SNIOverride != nil, BeforePort: service.ListenPort, AfterPort: next.ListenPort, BeforeSNI: service.ServerName, AfterSNI: next.ServerName})
				}
			}
		}
		if !impact.DraftOnly {
			impact.Changed = beforeCommand != canonicalCommand(t.Command) || proxy.PresetReferenceIssue(r.engine, c) != proxy.PresetReferenceIssue(r.engine, p.Config)
			if issue := proxy.PresetReferenceIssue(r.engine, c); issue != "" {
				impact.Issue = issue
				t.Error = "engine_unsupported"
			} else if err = checkTargetPorts(ctx, tx, t); err != nil {
				if !errors.Is(err, proxy.ErrConflict) && !errors.Is(err, proxy.ErrInvalid) {
					return preview, nil, err
				}
				impact.Issue = "端口或节点配置冲突，修正后重试同步"
				t.Error = "engine_port_conflict"
			} else {
				t.Error = ""
			}
			if impact.Changed {
				t.Actor = actor
				t.Revision = r.revision + 1
				t.Command.Revision = uint64(t.Revision)
				targets = append(targets, t)
			}
		}
		preview.Impacts = append(preview.Impacts, impact)
	}
	// Bind all displayed consequences and the authorized actor with a server MAC.
	fence = append(fence, digestJSON(preview.Impacts))
	mac := hmac.New(sha256.New, s.engineKey)
	mac.Write([]byte(digestJSON(fence)))
	preview.Confirmation = hex.EncodeToString(mac.Sum(nil))
	return preview, targets, nil
}

func (s *Store) UpdateProtocolPreset(ctx context.Context, actor, id string, edit proxy.PresetEdit) (proxy.PresetDetail, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return proxy.PresetDetail{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE protocol_presets SET id=id WHERE id=?`, id); err != nil {
		return proxy.PresetDetail{}, err
	}
	preview, targets, err := s.previewPreset(ctx, tx, actor, id, edit)
	if err != nil {
		return proxy.PresetDetail{}, err
	}
	if edit.Confirmation == "" || !hmac.Equal([]byte(edit.Confirmation), []byte(preview.Confirmation)) {
		return proxy.PresetDetail{}, proxy.ErrPresetStale
	}
	raw, err := json.Marshal(preview.Config)
	if err != nil {
		return proxy.PresetDetail{}, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE protocol_presets SET name=?,config_json=? WHERE id=?`, preview.Config.Name, string(raw), id); err != nil {
		return proxy.PresetDetail{}, err
	}
	changes := []realtime.Change{}
	for _, t := range targets {
		// A queued automatic operation has not reached the Agent and can be superseded.
		if _, err = tx.ExecContext(ctx, `UPDATE tasks SET state='cancelled',updated_at=? WHERE id IN (SELECT o.task_id FROM engine_operations o WHERE o.engine_id=? AND o.draft_version=-1) AND state='queued' AND attempt=0`, now(), t.ID); err != nil {
			return proxy.PresetDetail{}, err
		}
		if _, err = tx.ExecContext(ctx, `UPDATE engine_operations SET active=0 WHERE engine_id=? AND task_id IN (SELECT id FROM tasks WHERE state='cancelled')`, t.ID); err != nil {
			return proxy.PresetDetail{}, err
		}
		if err = s.writeTarget(ctx, tx, t, true); err != nil {
			return proxy.PresetDetail{}, err
		}
		if t.Error == "" {
			if err = reserveTarget(ctx, tx, t); err != nil {
				return proxy.PresetDetail{}, err
			}
		}
		changes = append(changes, realtime.Change{Kind: "node", NodeID: t.Node})
	}
	if err = audit(ctx, tx, actor, "protocol_preset.update", "protocol_preset", id); err != nil {
		return proxy.PresetDetail{}, err
	}
	p, err := scanPreset(tx.QueryRowContext(ctx, `SELECT id,config_json,created_at FROM protocol_presets WHERE id=?`, id))
	if err != nil {
		return proxy.PresetDetail{}, err
	}
	if err = s.commitChanges(tx, changes...); err != nil {
		return proxy.PresetDetail{}, err
	}
	return proxy.PresetDetail{Preset: p, Digest: digestJSON(p.Config)}, nil
}

func (s *Store) RetryEngineSync(ctx context.Context, actor, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE engines SET id=id WHERE id=?`, id); err != nil {
		return err
	}
	t, err := s.readTarget(ctx, tx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return auth.ErrNotFound
	}
	if err != nil {
		return err
	}
	if err = engineAccess(ctx, tx, actor, t.Node, true); err != nil {
		return err
	}
	var status string
	if err = tx.QueryRowContext(ctx, `SELECT status FROM engines WHERE id=?`, id).Scan(&status); err != nil {
		return err
	}
	if status == "unknown" || status == "degraded" {
		return proxy.ErrConflict
	}
	var desired int64
	if err = tx.QueryRowContext(ctx, `SELECT desired_revision FROM engines WHERE id=?`, id).Scan(&desired); err != nil {
		return err
	}
	if desired > t.Revision {
		t.Revision = desired + 1
		t.Actor = actor
		t.Error = ""
		if err = s.writeTarget(ctx, tx, t, true); err != nil {
			return err
		}
	}
	if _, err = tx.ExecContext(ctx, `UPDATE engine_targets SET sync_error='',updated_by=? WHERE engine_id=?`, actor, id); err != nil {
		return err
	}
	if err = audit(ctx, tx, actor, "engine.sync.retry", "engine", id); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "node", NodeID: t.Node})
}
