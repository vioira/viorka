package scheduler

import (
	"context"
	"encoding/json"
	"github.com/vioira/viorka/internal/auth"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type Task struct {
	ID             string          `json:"id"`
	NodeID         string          `json:"node_id"`
	Operation      string          `json:"operation"`
	IdempotencyKey string          `json:"idempotency_key"`
	State          string          `json:"state"`
	Attempt        uint64          `json:"attempt"`
	DeadlineAt     string          `json:"deadline_at"`
	Result         json.RawMessage `json:"result"`
}
type Repository interface {
	CreateTask(context.Context, string, string, string) (Task, error)
	Task(context.Context, string) (Task, error)
	Claim(context.Context, string) (*v1.TaskDispatch, error)
	Reply(context.Context, string, string, v1.TaskReply) error
}
type Service struct{ repo Repository }

func New(repo Repository) *Service { return &Service{repo} }
func (s *Service) Create(ctx context.Context, actor, node, operation, key string) (Task, error) {
	if operation != "node.inspect" || len(key) < 1 || len(key) > 128 {
		return Task{}, auth.ErrInvalid
	}
	return s.repo.CreateTask(ctx, actor, node, key)
}
func (s *Service) Get(ctx context.Context, id string) (Task, error) { return s.repo.Task(ctx, id) }
