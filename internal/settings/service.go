package settings

import (
	"context"
	"net"
	"net/url"
	"strings"

	"github.com/vioira/viorka/internal/auth"
)

type Config struct {
	Revision     int    `json:"revision"`
	PanelName    string `json:"panel_name"`
	PublicOrigin string `json:"public_origin"`
	Theme        string `json:"theme"`
	SSE          bool   `json:"sse"`
	Alerts       bool   `json:"alerts"`
	AutoBackup   bool   `json:"auto_backup"`
	Telemetry    bool   `json:"telemetry"`
}
type Notification struct {
	ID        string `json:"id"`
	NodeID    string `json:"node_id"`
	CreatedAt string `json:"created_at"`
	Message   string `json:"message"`
	Read      bool   `json:"read"`
}
type Repository interface {
	InitSettings(context.Context, string) error
	Settings(context.Context) (Config, error)
	SaveSettings(context.Context, string, Config) error
	Notifications(context.Context, string) ([]Notification, error)
	SetNotificationRead(context.Context, string, string, bool) error
	MarkNotificationsRead(context.Context, string, []string) error
}
type Service struct{ repo Repository }

func New(repo Repository) *Service                         { return &Service{repo: repo} }
func (s *Service) Get(ctx context.Context) (Config, error) { return s.repo.Settings(ctx) }
func (s *Service) Notifications(ctx context.Context, user string) ([]Notification, error) {
	return s.repo.Notifications(ctx, user)
}
func ValidOrigin(origin string) bool {
	u, e := url.Parse(origin)
	if e != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.ForceQuery || u.Opaque != "" {
		return false
	}
	if u.Scheme == "https" {
		return true
	}
	ip := net.ParseIP(u.Hostname())
	return u.Scheme == "http" && (u.Hostname() == "localhost" || (ip != nil && ip.IsLoopback()))
}
func (s *Service) Save(ctx context.Context, actor string, v Config) (Config, error) {
	v.PanelName = strings.TrimSpace(v.PanelName)
	if v.Revision < 1 || len(v.PanelName) < 1 || len(v.PanelName) > 128 || len(v.PublicOrigin) > 2048 || !ValidOrigin(v.PublicOrigin) || (v.Theme != "dark" && v.Theme != "light" && v.Theme != "system") || v.Telemetry {
		return Config{}, auth.ErrInvalid
	}
	if err := s.repo.SaveSettings(ctx, actor, v); err != nil {
		return Config{}, err
	}
	v.Revision++
	return v, nil
}

func (s *Service) SetNotificationRead(ctx context.Context, user, id string, read bool) error {
	if id == "" || len(id) > 128 {
		return auth.ErrInvalid
	}
	return s.repo.SetNotificationRead(ctx, user, id, read)
}

func (s *Service) MarkNotificationsRead(ctx context.Context, user string, ids []string) error {
	if len(ids) == 0 || len(ids) > 100 {
		return auth.ErrInvalid
	}
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id == "" || len(id) > 128 || seen[id] {
			return auth.ErrInvalid
		}
		seen[id] = true
	}
	return s.repo.MarkNotificationsRead(ctx, user, ids)
}
