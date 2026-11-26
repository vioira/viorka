package proxy

import "errors"

var (
	ErrRecoveryOccupied     = errors.New("engine recovery destination is occupied")
	ErrRecoveryOwned        = errors.New("engine recovery source is still owned")
	ErrRecoveryExpired      = errors.New("engine recovery preview expired")
	ErrRecoveryDisconnected = errors.New("engine recovery requires an active management connection")
	ErrRecoveryEnvironment  = errors.New("agent does not support managed engines on this node")
	ErrRecoveryUnsupported  = errors.New("agent does not advertise engine recovery")
)

type ManagedRecoveryPreview struct {
	State      string                   `json:"state"`
	ErrorCode  string                   `json:"error_code,omitempty"`
	EngineID   string                   `json:"engine_id,omitempty"`
	Name       string                   `json:"name"`
	Version    string                   `json:"version,omitempty"`
	Status     string                   `json:"status,omitempty"`
	RunIntent  string                   `json:"run_intent,omitempty"`
	Revision   uint64                   `json:"revision,omitempty"`
	Configured bool                     `json:"configured"`
	Services   []ManagedRecoveryService `json:"services"`
	Recovered  bool                     `json:"recovered"`
}

type ManagedRecoveryService struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Enabled    bool   `json:"enabled"`
	ListenPort uint64 `json:"listen_port"`
}
