package inventory

import (
	"context"
	"github.com/vioira/viorka/internal/monitoring"
)

type Node struct {
	Monitoring   *monitoring.Snapshot `json:"monitoring,omitempty"`
	ID           string               `json:"id"`
	Name         string               `json:"name"`
	Kind         string               `json:"kind"`
	State        string               `json:"state"`
	LastSeenAt   string               `json:"last_seen_at"`
	OS           string               `json:"os"`
	Arch         string               `json:"arch"`
	AgentVersion string               `json:"agent_version"`
}
type Repository interface {
	Nodes(context.Context, int, string) ([]Node, error)
	Node(context.Context, string) (Node, error)
}
