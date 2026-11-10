package httpapi

import (
	"github.com/vioira/viorka/internal/inventory"
	v1 "github.com/vioira/viorka/protocol/v1"
)

// These transport types are used both by handlers and the OpenAPI registry.
// Length limits enforced by services are byte limits (not JSON Schema character counts).
type LoginRequest struct {
	Username string `json:"username" doc:"1–64 bytes"`
	Password string `json:"password" doc:"1–72 bytes"`
}
type EnrollmentRequest struct {
	Name string `json:"name" doc:"1–128 bytes after trimming whitespace"`
	Kind string `json:"kind" enum:"vps,nat"`
}
type EnrollRequest struct {
	Engines         []*v1.EngineRecovery `json:"engines,omitempty" maxItems:"3" doc:"已核对的本机 Viorka 托管引擎，仅恢复缺失记录；包含敏感配置"`
	Token           string               `json:"token" doc:"64-byte single-use enrollment token; same key may retry before expiry"`
	PublicKey       string               `json:"public_key" doc:"Base64-encoded Ed25519 public key"`
	ProtocolVersion string               `json:"protocol_version" enum:"1.0"`
}
type ChallengeRequest struct {
	NodeID string `json:"node_id"`
}
type AgentSessionRequest struct {
	ChallengeID string `json:"challenge_id"`
	Signature   string `json:"signature" doc:"Base64-encoded Ed25519 signature over the challenge message"`
}
type TaskRequest struct {
	Operation      string `json:"operation" enum:"node.inspect"`
	IdempotencyKey string `json:"idempotency_key" doc:"1–128 bytes; deduplicated per node"`
}
type HealthResponse struct {
	Status string `json:"status"`
}
type ReadyResponse struct {
	Status string `json:"status"`
	Scope  string `json:"scope"`
}
type VersionResponse struct {
	Product string `json:"product"`
	Version string `json:"version"`
	Stage   string `json:"stage"`
}
type EnrollResponse struct {
	NodeID          string `json:"node_id"`
	ProtocolVersion string `json:"protocol_version"`
}
type NodesResponse struct {
	Items []inventory.Node `json:"items"`
}
type ErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type NodeTasksResponse struct {
	Items []TaskResponse `json:"items"`
}
