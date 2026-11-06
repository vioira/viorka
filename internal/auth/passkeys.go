package auth

import (
	"context"
	"encoding/json"
	"github.com/go-webauthn/webauthn/protocol"
	wa "github.com/go-webauthn/webauthn/webauthn"
	"net/url"
	"time"
)

type Passkey struct {
	ID         string        `json:"id"`
	Name       string        `json:"name"`
	CreatedAt  string        `json:"created_at"`
	LastUsedAt string        `json:"last_used_at"`
	Credential wa.Credential `json:"-"`
}
type Ceremony struct{ UserID, Kind, Binding, Data string }
type PasskeyRepository interface {
	UserByID(context.Context, string) (User, error)
	Passkeys(context.Context, string) ([]Passkey, error)
	SavePasskey(context.Context, User, string, wa.Credential) error
	UsePasskey(context.Context, string, wa.Credential, wa.Credential) error
	RemovePasskey(context.Context, string, string) error
	SaveCeremony(context.Context, string, Ceremony, time.Time) error
	TakeCeremony(context.Context, string, string, string) (Ceremony, error)
}
type WebUser struct {
	User
	Keys []wa.Credential
}

func (u WebUser) WebAuthnID() []byte                   { return []byte(u.ID) }
func (u WebUser) WebAuthnName() string                 { return u.Username }
func (u WebUser) WebAuthnDisplayName() string          { return u.Username }
func (u WebUser) WebAuthnCredentials() []wa.Credential { return u.Keys }
func (s *Service) WebUser(ctx context.Context, id string) (WebUser, error) {
	u, e := s.repo.UserByID(ctx, id)
	if e != nil {
		return WebUser{}, e
	}
	keys, e := s.repo.Passkeys(ctx, id)
	w := WebUser{User: u}
	for _, k := range keys {
		w.Keys = append(w.Keys, k.Credential)
	}
	return w, e
}
func (s *Service) Passkeys(ctx context.Context, id string) ([]Passkey, error) {
	return s.repo.Passkeys(ctx, id)
}
func (s *Service) RemovePasskey(ctx context.Context, id, key string) error {
	return s.repo.RemovePasskey(ctx, id, key)
}
func NewWebAuthn(origin string) (*wa.WebAuthn, error) {
	u, e := url.Parse(origin)
	if e != nil || u.Hostname() == "" || (u.Scheme != "https" && !(u.Scheme == "http" && u.Hostname() == "localhost")) {
		return nil, ErrInvalid
	}
	return wa.New(&wa.Config{RPDisplayName: "Viorka", RPID: u.Hostname(), RPOrigins: []string{origin}, AuthenticatorSelection: protocol.AuthenticatorSelection{UserVerification: protocol.VerificationRequired, ResidentKey: protocol.ResidentKeyRequirementRequired}})
}
func (s *Service) SaveCeremony(ctx context.Context, user, kind, binding string, data *wa.SessionData) (string, error) {
	data.Expires = time.Now().UTC().Add(5 * time.Minute)
	b, e := json.Marshal(data)
	if e != nil {
		return "", e
	}
	token := Random()
	e = s.repo.SaveCeremony(ctx, Hash(token), Ceremony{user, kind, binding, string(b)}, data.Expires)
	return token, e
}
func (s *Service) TakeCeremony(ctx context.Context, token, kind, binding string) (WebUser, wa.SessionData, error) {
	if len(token) != 64 {
		return WebUser{}, wa.SessionData{}, ErrUnauthorized
	}
	c, e := s.repo.TakeCeremony(ctx, Hash(token), kind, binding)
	if e != nil {
		return WebUser{}, wa.SessionData{}, e
	}
	var data wa.SessionData
	if e = json.Unmarshal([]byte(c.Data), &data); e != nil {
		return WebUser{}, data, e
	}
	u, e := s.WebUser(ctx, c.UserID)
	return u, data, e
}
func (s *Service) SavePasskey(ctx context.Context, u User, name string, c wa.Credential) error {
	return s.repo.SavePasskey(ctx, u, name, c)
}
func (s *Service) UsePasskey(ctx context.Context, id string, old, c wa.Credential) error {
	return s.repo.UsePasskey(ctx, id, old, c)
}
func (s *Service) UserForPasskey(ctx context.Context, name string) (WebUser, error) {
	u, e := s.repo.UserByName(ctx, name)
	if e != nil {
		return WebUser{}, e
	}
	return s.WebUser(ctx, u.ID)
}
