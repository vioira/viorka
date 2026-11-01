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
	NodeName       string          `json:"node_name"`
	MaxAttempts    uint64          `json:"max_attempts"`
	CreatedAt      string          `json:"created_at"`
	UpdatedAt      string          `json:"updated_at"`
	ErrorCode      string          `json:"error_code"`
}
type Repository interface {
	Tasks(context.Context, string, int, string) ([]Task, error)
	TaskPage(context.Context, int, string, string) (Page, error)
	TaskSummary(context.Context) (Summary, error)
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

func (s *Service) List(ctx context.Context, node string, limit int, after string) ([]Task, error) {
	if limit < 1 || limit > 100 || len(after) > 128 {
		return nil, auth.ErrInvalid
	}
	return s.repo.Tasks(ctx, node, limit, after)
}

// Page uses an exclusive task ID cursor ordered by creation time and ID descending.
type Page struct {
	Items      []Task `json:"items"`
	NextCursor string `json:"next_cursor"`
}

// Summary counts tasks created in [Since, Until]; Active spans all creation times.
// Retries remain one task. SuccessRate excludes pending and canceled tasks.
type Summary struct {
	Since       string   `json:"since"`
	Until       string   `json:"until"`
	Total       uint64   `json:"total"`
	Succeeded   uint64   `json:"succeeded"`
	Failed      uint64   `json:"failed"`
	Active      uint64   `json:"active"`
	SuccessRate *float64 `json:"success_rate"`
}

func (s *Service) Page(ctx context.Context, limit int, after, state string) (Page, error) {
	if limit < 1 || limit > 100 || len(after) > 128 {
		return Page{}, auth.ErrInvalid
	}
	switch state {
	case "all", "queued", "dispatched", "accepted", "running", "succeeded", "failed", "cancelled", "rolled_back":
	default:
		return Page{}, auth.ErrInvalid
	}
	return s.repo.TaskPage(ctx, limit, after, state)
}
func (s *Service) Summary(ctx context.Context) (Summary, error) { return s.repo.TaskSummary(ctx) }
