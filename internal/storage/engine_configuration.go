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

type engineConfigurationReply struct {
	v1.TaskReply
	ConfigurationEncrypted string `json:"configuration_encrypted,omitempty"`
}

func (s *Store) EngineConfiguration(ctx context.Context, actor, id, task string) (proxy.EngineConfigurationResult, error) {
	var out proxy.EngineConfigurationResult
	var node, raw string
	err := s.db.QueryRowContext(ctx, `SELECT node_id FROM engines WHERE id=?`, id).Scan(&node)
	if errors.Is(err, sql.ErrNoRows) {
		return out, auth.ErrNotFound
	}
	if err != nil {
		return out, err
	}
	if err = engineAccess(ctx, s.db, actor, node, true); err != nil {
		return out, err
	}
	err = s.db.QueryRowContext(ctx, `SELECT t.id,t.state,t.updated_at,coalesce(t.result_json,'{}') FROM tasks t JOIN engine_operations o ON o.task_id=t.id WHERE o.engine_id=? AND t.id=? AND o.operation='engine.inspect' AND json_extract(o.request_json,'$.include_config')=1`, id, task).Scan(&out.TaskID, &out.State, &out.CapturedAt, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, auth.ErrNotFound
	}
	if err != nil {
		return out, err
	}
	var reply engineConfigurationReply
	if err = json.Unmarshal([]byte(raw), &reply); err != nil {
		return out, err
	}
	out.ErrorCode = reply.ErrorCode
	if reply.Engine != nil {
		out.RuntimeStatus = reply.Engine.Status
		if reply.ConfigurationEncrypted != "" {
			content, err := s.openEngine(id, reply.ConfigurationEncrypted)
			if err != nil {
				return out, err
			}
			if err = json.Unmarshal(content, &out.Configuration); err != nil {
				return out, err
			}
		}
	}
	return out, nil
}
