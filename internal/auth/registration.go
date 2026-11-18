package auth

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	v1 "github.com/vioira/viorka/protocol/v1"
)

var ErrRegistrationLimit = fmt.Errorf("registration limit reached: %w", ErrConflict)

type RegistrationOptions struct {
	Name           string `json:"name" doc:"1–128 UTF-8 bytes after trimming; control characters forbidden"`
	Kind           string `json:"kind" enum:"vps,nat"`
	NamePrefix     string `json:"name_prefix,omitempty" doc:"Optional prefix, at most 32 UTF-8 bytes; control characters forbidden"`
	ExpiresInHours int    `json:"expires_in_hours" minimum:"1" maximum:"720"`
	MaxUses        int    `json:"max_uses" minimum:"1" maximum:"10000"`
}
type RegistrationToken struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	Kind       string     `json:"kind"`
	NamePrefix string     `json:"name_prefix"`
	MaxUses    int        `json:"max_uses"`
	UsedCount  int        `json:"used_count"`
	CreatedBy  string     `json:"created_by"`
	CreatedAt  time.Time  `json:"created_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
}
type RegistrationSecret struct {
	RegistrationToken
	Token string `json:"token"`
}
type RegistrationRecord struct {
	ID        string `json:"id"`
	NodeID    string `json:"node_id"`
	Name      string `json:"name"`
	State     string `json:"state"`
	CreatedAt string `json:"created_at"`
}
type RegisterRequest struct {
	Token           string               `json:"token" doc:"64-byte single-node or batch registration token; only valid until expiry or revocation"`
	PublicKey       string               `json:"public_key" doc:"Base64-encoded Ed25519 public key"`
	ProtocolVersion string               `json:"protocol_version" enum:"1.0"`
	Name            string               `json:"name,omitempty" doc:"Optional display name, at most 128 UTF-8 bytes after trimming"`
	Hostname        string               `json:"hostname,omitempty" doc:"Optional hostname, at most 253 UTF-8 bytes after trimming; used only for naming"`
	Engines         []*v1.EngineRecovery `json:"engines,omitempty" doc:"Managed engine snapshots for single-node or batch registration; at most 3 entries"`
}
type RegistrationRepository interface {
	CreateRegistrationToken(context.Context, RegistrationToken, string) error
	RegistrationTokenValue(context.Context, string) (string, error)
	RegistrationTokens(context.Context, int, string) ([]RegistrationToken, error)
	RevokeRegistrationToken(context.Context, string, string) error
	RegistrationRecords(context.Context, string, int, string) ([]RegistrationRecord, error)
	RegisterAgent(context.Context, string, string, string, string, []*v1.EngineRecovery) (string, error)
}

// ValidName uses the same byte limit for API and generated node names.
func ValidName(s string, max int) bool {
	return s != "" && len(s) <= max && utf8.ValidString(s) && !strings.ContainsFunc(s, unicode.IsControl)
}
func (a *Agents) CreateRegistrationToken(ctx context.Context, actor string, o RegistrationOptions) (RegistrationSecret, error) {
	o.Name = strings.TrimSpace(o.Name)
	if !ValidName(o.Name, 128) || (o.Kind != "vps" && o.Kind != "nat") || (o.NamePrefix != "" && !ValidName(o.NamePrefix, 32)) || o.ExpiresInHours < 1 || o.ExpiresInHours > 720 || o.MaxUses < 1 || o.MaxUses > 10000 {
		return RegistrationSecret{}, ErrInvalid
	}
	now := time.Now().UTC()
	v := RegistrationSecret{RegistrationToken: RegistrationToken{ID: Random(), Name: o.Name, Kind: o.Kind, NamePrefix: o.NamePrefix, MaxUses: o.MaxUses, CreatedBy: actor, CreatedAt: now, ExpiresAt: now.Add(time.Duration(o.ExpiresInHours) * time.Hour)}, Token: Random()}
	return v, a.repo.CreateRegistrationToken(ctx, v.RegistrationToken, v.Token)
}
func (a *Agents) RegistrationTokenValue(ctx context.Context, id string) (string, error) {
	return a.repo.RegistrationTokenValue(ctx, id)
}
func (a *Agents) RegistrationTokens(ctx context.Context, limit int, after string) ([]RegistrationToken, error) {
	return a.repo.RegistrationTokens(ctx, limit, after)
}
func (a *Agents) RevokeRegistrationToken(ctx context.Context, actor, id string) error {
	return a.repo.RevokeRegistrationToken(ctx, actor, id)
}
func (a *Agents) RegistrationRecords(ctx context.Context, id string, limit int, after string) ([]RegistrationRecord, error) {
	return a.repo.RegistrationRecords(ctx, id, limit, after)
}
func (a *Agents) Register(ctx context.Context, v RegisterRequest) (string, error) {
	key, err := base64.StdEncoding.DecodeString(v.PublicKey)
	v.Name = strings.TrimSpace(v.Name)
	v.Hostname = strings.TrimSpace(v.Hostname)
	if err != nil || len(key) != ed25519.PublicKeySize || len(v.Token) != 64 || v.ProtocolVersion != "1.0" || (v.Name != "" && !ValidName(v.Name, 128)) || (v.Hostname != "" && !ValidName(v.Hostname, 253)) {
		return "", ErrInvalid
	}
	if err := v1.ValidateEngineRecovery(v.Engines); err != nil {
		return "", ErrInvalid
	}
	hash, publicKey := Hash(v.Token), base64.StdEncoding.EncodeToString(key)
	// Single-node tokens bind the existing node and retain recovery semantics.
	// Only a token/key authentication miss proceeds to the separate batch store.
	id, err := a.repo.Enroll(ctx, hash, publicKey, v.Engines...)
	if !errors.Is(err, ErrUnauthorized) {
		return id, err
	}
	return a.repo.RegisterAgent(ctx, hash, publicKey, v.Name, v.Hostname, v.Engines)
}

// RegistrationName truncates only the generated hostname, preserving UTF-8.
func RegistrationName(name, prefix, hostname, id string) string {
	if name != "" {
		return name
	}
	if hostname == "" {
		hostname = id[:12]
	}
	for len(prefix)+len(hostname) > 128 {
		_, size := utf8.DecodeLastRuneInString(hostname)
		hostname = hostname[:len(hostname)-size]
	}
	return prefix + hostname
}
