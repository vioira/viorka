// Package domain contains transport-independent resource definitions.
// Persistence, validation, and API DTOs will be introduced in M0/M1.
package domain

// NodeKind is descriptive; NAT capabilities are expressed separately.
type NodeKind string

const (
	NodeVPS   NodeKind = "vps"
	NodeNAT   NodeKind = "nat"
	NodeRelay NodeKind = "relay"
)

type Node struct {
	ID      string
	Name    string
	Kind    NodeKind
	AgentID string
	Online  bool
}

type PortAllocation struct {
	ID          string
	NodeID      string
	PublicHost  string
	PublicPort  uint16
	PrivateHost string
	PrivatePort uint16
	Transport   string // tcp, udp; capabilities must be validated at the boundary.
	Owner       string // provider, node, manual
}

type DesiredResource struct {
	NodeID       string
	ResourceKind string
	ResourceID   string
	Revision     uint64
	ConfigSHA256 string
}
