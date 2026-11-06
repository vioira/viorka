package auth

import "context"

type LoginMetadata struct{ IP, UserAgent, Source, Method, PasskeyID string }
type metadataKey struct{}

func WithLoginMetadata(ctx context.Context, v LoginMetadata) context.Context {
	return context.WithValue(ctx, metadataKey{}, v)
}
func Metadata(ctx context.Context) LoginMetadata {
	v, _ := ctx.Value(metadataKey{}).(LoginMetadata)
	return v
}

type SessionIP struct {
	Location    string `json:"location"`
	IP          string `json:"ip"`
	FirstUsedAt string `json:"first_used_at"`
	LastUsedAt  string `json:"last_used_at"`
}
type SessionRecord struct {
	FirstLocation  string      `json:"first_location"`
	LatestLocation string      `json:"latest_location"`
	ID             string      `json:"id"`
	UserID         string      `json:"user_id"`
	Username       string      `json:"username"`
	Method         string      `json:"method"`
	Source         string      `json:"source"`
	UserAgent      string      `json:"user_agent"`
	FirstIP        string      `json:"first_ip"`
	LatestIP       string      `json:"latest_ip"`
	CreatedAt      string      `json:"created_at"`
	LastActiveAt   string      `json:"last_active_at"`
	ExpiresAt      string      `json:"expires_at"`
	EndedAt        string      `json:"ended_at"`
	EndReason      string      `json:"end_reason"`
	Current        bool        `json:"current"`
	IPs            []SessionIP `json:"ips"`
}
type HistoryRepository interface {
	SessionHistory(context.Context, string, string, string, int) ([]SessionRecord, error)
	RevokeSession(context.Context, string, string) error
	TouchSession(context.Context, string, LoginMetadata) error
}

func (s *Service) SessionHistory(ctx context.Context, user, token, after string, limit int) ([]SessionRecord, error) {
	return s.repo.SessionHistory(ctx, user, Hash(token), after, limit)
}
func (s *Service) RevokeSession(ctx context.Context, user, id string) error {
	return s.repo.RevokeSession(ctx, user, id)
}
func (s *Service) TouchSession(ctx context.Context, token string) error {
	return s.repo.TouchSession(ctx, Hash(token), Metadata(ctx))
}
