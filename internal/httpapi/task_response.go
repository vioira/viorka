package httpapi

import (
	"encoding/json"
	"github.com/vioira/viorka/internal/scheduler"
)

// TaskResponse keeps display names in the REST boundary, separate from dispatch operations.
type TaskResponse struct {
	ID             string          `json:"id"`
	NodeID         string          `json:"node_id"`
	Operation      string          `json:"operation"`
	IdempotencyKey string          `json:"idempotency_key"`
	State          string          `json:"state"`
	Attempt        uint64          `json:"attempt"`
	DeadlineAt     string          `json:"deadline_at"`
	Result         json.RawMessage `json:"result"`
	NodeName       string          `json:"node_name"`
	MaxAttempts    uint64          `json:"max_attempts"`
	CreatedAt      string          `json:"created_at"`
	UpdatedAt      string          `json:"updated_at"`
	ErrorCode      string          `json:"error_code"`
	OperationName  string          `json:"operation_name" doc:"Human-readable Chinese task type; unknown operations retain their code"`
}

type TaskPageResponse struct {
	Items      []TaskResponse `json:"items"`
	NextCursor string         `json:"next_cursor"`
}

func taskResponse(task scheduler.Task) TaskResponse {
	return TaskResponse{
		ID:             task.ID,
		NodeID:         task.NodeID,
		Operation:      task.Operation,
		IdempotencyKey: task.IdempotencyKey,
		State:          task.State,
		Attempt:        task.Attempt,
		DeadlineAt:     task.DeadlineAt,
		Result:         task.Result,
		NodeName:       task.NodeName,
		MaxAttempts:    task.MaxAttempts,
		CreatedAt:      task.CreatedAt,
		UpdatedAt:      task.UpdatedAt,
		ErrorCode:      task.ErrorCode,
		OperationName:  taskOperationName(task.Operation),
	}
}

func taskResponses(tasks []scheduler.Task) []TaskResponse {
	items := make([]TaskResponse, len(tasks))
	for i, task := range tasks {
		items[i] = taskResponse(task)
	}
	return items
}

func taskOperationName(operation string) string {
	switch operation {
	case "node.inspect":
		return "检查节点"
	case "traffic.calibrate":
		return "校准节点流量"
	case "engine.install":
		return "安装引擎"
	case "engine.upgrade":
		return "升级引擎"
	case "engine.start":
		return "启动引擎"
	case "engine.stop":
		return "停止引擎"
	case "engine.uninstall":
		return "卸载引擎"
	case "engine.apply":
		return "应用引擎配置"
	case "engine.inspect":
		return "检查引擎"
	default:
		return operation
	}
}
