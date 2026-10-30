package auth

import (
	"context"
	"golang.org/x/crypto/bcrypt"
	"net/mail"
	"strings"
	"time"
)

type Account struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	Status    string `json:"status"`
	ExpiresAt string `json:"expires_at,omitempty"`
}
type Invitation struct {
	ID        string    `json:"id"`
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}
type AccountRepository interface {
	Accounts(context.Context, int, string) ([]Account, error)
	ChangePassword(context.Context, string, string, string, string) error
	LogoutAll(context.Context, string) error
	Invite(context.Context, string, Account, string, time.Time) error
	AcceptInvitation(context.Context, string, User) error
	RemoveAccount(context.Context, string, string) error
	ChangeRole(context.Context, string, string, string) error
}

func (s *Service) VerifyPassword(ctx context.Context, username, password string) (User, error) {
	if len(password) < 1 || len(password) > 72 {
		return User{}, ErrUnauthorized
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		return User{}, ctx.Err()
	}
	u, e := s.repo.UserByName(ctx, username)
	if e != nil {
		return User{}, e
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return User{}, ErrUnauthorized
	}
	return u, nil
}
func (s *Service) ChangePassword(ctx context.Context, sess Session, current, next, token string) error {
	if len(next) < 12 || len(next) > 72 || next == current {
		return ErrInvalid
	}
	u, e := s.VerifyPassword(ctx, sess.User.Username, current)
	if e != nil {
		return e
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		return ctx.Err()
	}
	hash, e := bcrypt.GenerateFromPassword([]byte(next), bcrypt.DefaultCost)
	if e != nil {
		return e
	}
	return s.repo.ChangePassword(ctx, u.ID, u.PasswordHash, string(hash), Hash(token))
}
func (s *Service) Accounts(ctx context.Context, limit int, after string) ([]Account, error) {
	return s.repo.Accounts(ctx, limit, after)
}
func (s *Service) LogoutAll(ctx context.Context, id string) error {
	return s.repo.LogoutAll(ctx, id)
}
func validRole(role string) bool { return role == "admin" || role == "operator" || role == "viewer" }
func (s *Service) Invite(ctx context.Context, actor, name, email, role string) (Invitation, error) {
	name = strings.TrimSpace(name)
	email = strings.TrimSpace(email)
	a, e := mail.ParseAddress(email)
	if len(name) < 1 || len(name) > 64 || len(email) > 254 || e != nil || a.Address != email || !validRole(role) {
		return Invitation{}, ErrInvalid
	}
	v := Invitation{Random(), Random(), time.Now().UTC().Add(24 * time.Hour)}
	e = s.repo.Invite(ctx, actor, Account{ID: v.ID, Username: name, Email: email, Role: role}, Hash(v.Token), v.ExpiresAt)
	return v, e
}
func (s *Service) AcceptInvitation(ctx context.Context, token, password string) error {
	if len(token) != 64 || len(password) < 12 || len(password) > 72 {
		return ErrInvalid
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		return ctx.Err()
	}
	h, e := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if e != nil {
		return e
	}
	return s.repo.AcceptInvitation(ctx, Hash(token), User{ID: Random(), PasswordHash: string(h)})
}
func (s *Service) RemoveAccount(ctx context.Context, actor, id string) error {
	if id == actor {
		return ErrConflict
	}
	return s.repo.RemoveAccount(ctx, actor, id)
}
func (s *Service) ChangeRole(ctx context.Context, actor, id, role string) error {
	if !validRole(role) {
		return ErrInvalid
	}
	return s.repo.ChangeRole(ctx, actor, id, role)
}
