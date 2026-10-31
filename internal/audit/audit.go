// Package audit defines the read-only audit log boundary.
package audit

import "context"

type Record struct {
	ID           string
	ActorID      string
	Actor        string
	Action       string
	ResourceType string
	ResourceID   string
	SourceIP     string
	CreatedAt    string
}

type Repository interface {
	AuditLogs(context.Context, int, string, string) ([]Record, error)
}
