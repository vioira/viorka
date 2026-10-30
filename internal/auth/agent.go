package auth

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"time"
)

type Enrollment struct {
	ID        string    `json:"id"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}
type Challenge struct {
	ID        string    `json:"id"`
	Message   string    `json:"message"`
	ExpiresAt time.Time `json:"expires_at"`
}
type AgentSession struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}
type AgentRepository interface {
	Enrollments(context.Context, int, string) ([]EnrollmentRecord, error)
	CreateEnrollment(context.Context, string, string, string, string, Enrollment) error
	RevokeEnrollment(context.Context, string, string) error
	Enroll(context.Context, string, string, string) (string, error)
	AgentKey(context.Context, string) (string, error)
	SaveChallenge(context.Context, string, Challenge) error
	ConsumeChallenge(context.Context, string, func(string, string) bool, string, time.Time) (string, error)
	AgentSession(context.Context, string) (string, time.Time, error)
	RevokeNode(context.Context, string, string) error
}
type Agents struct {
	repo   AgentRepository
	origin string
}

func NewAgents(repo AgentRepository, origin string) *Agents { return &Agents{repo, origin} }
func (a *Agents) CreateEnrollment(ctx context.Context, actor, name, kind string) (Enrollment, error) {
	if len(name) < 1 || len(name) > 128 || (kind != "vps" && kind != "nat" && kind != "relay") {
		return Enrollment{}, ErrInvalid
	}
	v := Enrollment{Random(), Random(), time.Now().UTC().Add(15 * time.Minute)}
	return v, a.repo.CreateEnrollment(ctx, actor, name, kind, Hash(v.Token), v)
}
func (a *Agents) RevokeEnrollment(ctx context.Context, actor, id string) error {
	return a.repo.RevokeEnrollment(ctx, actor, id)
}
func (a *Agents) Enroll(ctx context.Context, token, key, version string) (string, error) {
	p, err := base64.StdEncoding.DecodeString(key)
	if err != nil || len(p) != ed25519.PublicKeySize || version != "1.0" || len(token) != 64 {
		return "", ErrInvalid
	}
	key = base64.StdEncoding.EncodeToString(p)
	id := Random()
	return a.repo.Enroll(ctx, Hash(token), key, id)
}
func (a *Agents) Challenge(ctx context.Context, id string) (Challenge, error) {
	if _, err := a.repo.AgentKey(ctx, id); err != nil {
		return Challenge{}, err
	}
	c := Challenge{ID: Random(), ExpiresAt: time.Now().UTC().Add(time.Minute)}
	c.Message = fmt.Sprintf("viorka-agent-session-v1\n%s\n%s\n%s\n%s", a.origin, id, c.ID, c.ExpiresAt.Format(time.RFC3339Nano))
	return c, a.repo.SaveChallenge(ctx, id, c)
}
func (a *Agents) Session(ctx context.Context, id, signature string) (AgentSession, error) {
	sig, err := base64.StdEncoding.DecodeString(signature)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return AgentSession{}, ErrUnauthorized
	}
	v := AgentSession{Random(), time.Now().UTC().Add(15 * time.Minute)}
	_, err = a.repo.ConsumeChallenge(ctx, id, func(key, msg string) bool {
		k, e := base64.StdEncoding.DecodeString(key)
		return e == nil && len(k) == 32 && ed25519.Verify(k, []byte(msg), sig)
	}, Hash(v.Token), v.ExpiresAt)
	return v, err
}
func (a *Agents) Authenticate(ctx context.Context, token string) (string, time.Time, error) {
	if len(token) != 64 {
		return "", time.Time{}, ErrUnauthorized
	}
	return a.repo.AgentSession(ctx, Hash(token))
}
func (a *Agents) Revoke(ctx context.Context, actor, id string) error {
	return a.repo.RevokeNode(ctx, actor, id)
}

type EnrollmentRecord struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
	State     string    `json:"state"`
}

func (a *Agents) Enrollments(ctx context.Context, limit int, after string) ([]EnrollmentRecord, error) {
	return a.repo.Enrollments(ctx, limit, after)
}
