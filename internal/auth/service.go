package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

var ErrUnauthorized = errors.New("unauthorized")
var ErrConflict = errors.New("conflict")
var ErrNotFound = errors.New("not found")
var ErrInvalid = errors.New("invalid input")

type User struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	Role         string `json:"role"`
	PasswordHash string `json:"-"`
}
type Session struct {
	User      User      `json:"user"`
	CSRF      string    `json:"csrf_token"`
	ExpiresAt time.Time `json:"expires_at"`
}
type Repository interface {
	Bootstrap(context.Context, User) error
	UserByName(context.Context, string) (User, error)
	SaveSession(context.Context, string, Session) error
	Session(context.Context, string) (Session, error)
	DeleteSession(context.Context, string) error
}
type Service struct {
	repo  Repository
	dummy []byte
	slots chan struct{}
}

func New(repo Repository) (*Service, error) {
	h, err := bcrypt.GenerateFromPassword([]byte("dummy-not-a-real-password"), bcrypt.DefaultCost)
	return &Service{repo: repo, dummy: h, slots: make(chan struct{}, 4)}, err
}
func Random() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func Hash(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func (s *Service) Bootstrap(ctx context.Context, name, password string) error {
	if strings.TrimSpace(name) == "" || len(name) > 64 || len(password) < 12 || len(password) > 72 {
		return fmt.Errorf("bootstrap username required; password must contain 12 to 72 bytes")
	}
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.repo.Bootstrap(ctx, User{ID: Random(), Username: name, Role: "admin", PasswordHash: string(h)})
}
func (s *Service) Login(ctx context.Context, name, password string) (string, Session, error) {
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		return "", Session{}, ctx.Err()
	}
	u, err := s.repo.UserByName(ctx, name)
	h := []byte(u.PasswordHash)
	if errors.Is(err, ErrUnauthorized) {
		h = s.dummy
	} else if err != nil {
		return "", Session{}, err
	}
	valid := bcrypt.CompareHashAndPassword(h, []byte(password))
	if err != nil || valid != nil {
		return "", Session{}, ErrUnauthorized
	}
	token := Random()
	sess := Session{User: u, CSRF: Random(), ExpiresAt: time.Now().UTC().Add(12 * time.Hour)}
	if err = s.repo.SaveSession(ctx, Hash(token), sess); err != nil {
		return "", Session{}, err
	}
	return token, sess, nil
}
func (s *Service) Session(ctx context.Context, token string) (Session, error) {
	if len(token) != 64 {
		return Session{}, ErrUnauthorized
	}
	return s.repo.Session(ctx, Hash(token))
}
func (s *Service) Logout(ctx context.Context, token string) error {
	return s.repo.DeleteSession(ctx, Hash(token))
}
