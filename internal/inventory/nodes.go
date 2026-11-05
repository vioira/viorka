package inventory

import (
	"context"
	"errors"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

var (
	ErrNodeBusy       = errors.New("node has unfinished tasks")
	ErrNodeReferenced = errors.New("node has configuration dependencies")
)

type Node struct {
	Location     Location             `json:"location"`
	Inventory    *v1.NodeInventory    `json:"inventory,omitempty"`
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
	DeleteNode(context.Context, string, string) error
}
