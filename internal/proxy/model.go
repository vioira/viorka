package proxy

import (
	"context"
	"errors"

	"net"
	"net/netip"
	"strings"
	"unicode"
)

var (
	ErrInvalid     = errors.New("invalid engine configuration")
	ErrConflict    = errors.New("engine revision conflict")
	ErrForbidden   = errors.New("engine access denied")
	ErrUnavailable = errors.New("engine capability unavailable")
)

const MaxServices = 32

// Service is the non-secret, structured input. Node and engine are immutable
// parents; credentials never travel in ordinary list or draft responses.
type Service struct {
	PresetID      string  `json:"preset_id,omitempty"`
	PortOverride  *int    `json:"port_override,omitempty"`
	SNIOverride   *string `json:"sni_override,omitempty"`
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Enabled       bool    `json:"enabled"`
	PendingDelete bool    `json:"pending_delete"`
	ListenHost    string  `json:"listen_host"`
	ListenPort    int     `json:"listen_port"`
	TargetHost    string  `json:"target_host"`
	TargetPort    int     `json:"target_port"`
	ServerName    string  `json:"server_name"`
	PublicHost    string  `json:"public_host"`
	PublicPort    int     `json:"public_port"`
}

type Draft struct {
	Routing   *Routing  `json:"routing,omitempty"`
	Version   int64     `json:"version"`
	Services  []Service `json:"services"`
	UpdatedBy string    `json:"updated_by"`
	UpdatedAt string    `json:"updated_at"`
}

type Engine struct {
	SyncState            string `json:"sync_state"`
	SyncError            string `json:"sync_error"`
	ObservedAt           string `json:"observed_at"`
	ID                   string `json:"id"`
	NodeID               string `json:"node_id"`
	Name                 string `json:"name"`
	Version              string `json:"version"`
	Ownership            string `json:"ownership"`
	Status               string `json:"status"`
	RunIntent            string `json:"run_intent"`
	DesiredRevision      int64  `json:"desired_revision"`
	ObservedRevision     int64  `json:"observed_revision"`
	ExternalConnectivity string `json:"external_connectivity"`
	Draft                Draft  `json:"draft"`
}

type Repository interface {
	Engines(context.Context, string, string) ([]Engine, error)
	Engine(context.Context, string, string) (Engine, error)
	SaveEngineDraft(context.Context, string, string, Draft) (Draft, error)
}

type Manager struct{ repo Repository }

func New(repo Repository) *Manager { return &Manager{repo} }
func (m *Manager) List(ctx context.Context, actor, node string) ([]Engine, error) {
	return m.repo.Engines(ctx, actor, node)
}
func (m *Manager) Get(ctx context.Context, actor, id string) (Engine, error) {
	return m.repo.Engine(ctx, actor, id)
}
func (m *Manager) SaveDraft(ctx context.Context, actor, id string, d Draft) (Draft, error) {
	e, err := m.repo.Engine(ctx, actor, id)
	if err != nil {
		return Draft{}, err
	}
	if e.Ownership != "managed" || e.Status == "not_installed" || e.Version == "" {
		return Draft{}, ErrConflict
	}
	if err = ValidateDraft(e.Name, d); err != nil {
		return Draft{}, err
	}
	return m.repo.SaveEngineDraft(ctx, actor, id, d)
}

func ValidEngine(name string) bool { return name == "sing-box" || name == "xray" || name == "realm" }
func ValidHost(host string) bool {
	if a, err := netip.ParseAddr(host); err == nil {
		return a.Zone() == "" && !a.IsUnspecified() && !a.IsMulticast()
	}
	if len(host) < 1 || len(host) > 253 || strings.HasSuffix(host, ".") {
		return false
	}
	for _, label := range strings.Split(host, ".") {
		if len(label) < 1 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, c := range label {
			if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	return true
}
func ValidID(id string) bool {
	if len(id) < 1 || len(id) > 64 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}
func ValidateDraft(engine string, d Draft) error {
	if d.Routing != nil {
		if engine != "sing-box" {
			return ErrInvalid
		}
		if d.Routing.Validate(d.Services) != nil {
			return ErrInvalid
		}
	}
	if !ValidEngine(engine) || d.Version < 0 || d.Version > 1<<53-1 || len(d.Services) > MaxServices {
		return ErrInvalid
	}
	seen := map[string]bool{}
	for i, s := range d.Services {
		if (s.PresetID != "" && (!ValidID(s.PresetID) || engine == "realm")) || !ValidID(s.ID) || seen[s.ID] || len(s.Name) < 1 || len(s.Name) > 128 || strings.TrimSpace(s.Name) != s.Name || strings.IndexFunc(s.Name, unicode.IsControl) >= 0 {
			return ErrInvalid
		}
		seen[s.ID] = true
		if s.PortOverride != nil && (*s.PortOverride < 1 || *s.PortOverride > 65535) || s.SNIOverride != nil && (!ValidHost(*s.SNIOverride) || net.ParseIP(*s.SNIOverride) != nil) || s.PresetID == "" && (s.PortOverride != nil || s.SNIOverride != nil) {
			return ErrInvalid
		}
		addr, err := netip.ParseAddr(s.ListenHost)
		if err != nil || addr.Zone() != "" || addr.Is4In6() || addr.IsMulticast() || s.ListenPort < 1 || s.ListenPort > 65535 {
			return ErrInvalid
		}
		if !ValidHost(s.TargetHost) || s.TargetPort < 1 || s.TargetPort > 65535 {
			return ErrInvalid
		}
		if engine == "realm" {
			if s.ServerName != "" {
				return ErrInvalid
			}
			if s.ListenPort == s.TargetPort {
				target, e := netip.ParseAddr(s.TargetHost)
				if strings.EqualFold(s.TargetHost, "localhost") || (e == nil && (target == addr || addr.IsUnspecified() && target.IsLoopback())) {
					return ErrInvalid
				}
			}
		} else if !ValidHost(s.ServerName) || net.ParseIP(s.ServerName) != nil {
			return ErrInvalid
		}
		if (s.PublicHost == "") != (s.PublicPort == 0) || s.PublicHost != "" && (!ValidHost(s.PublicHost) || s.PublicPort < 1 || s.PublicPort > 65535) {
			return ErrInvalid
		}
		for _, other := range d.Services[:i] {
			if PortsConflict(s.ListenHost, s.ListenPort, other.ListenHost, other.ListenPort) {
				return ErrConflict
			}
		}
	}
	return nil
}

// Conservatively reserves dual-stack wildcard binds. Disabled and pending-delete
// services retain their reservation until a confirmed application releases it.
func PortsConflict(a string, ap int, b string, bp int) bool {
	if ap != bp {
		return false
	}
	x, ex := netip.ParseAddr(a)
	y, ey := netip.ParseAddr(b)
	if ex != nil || ey != nil {
		return true
	}
	x = x.Unmap()
	y = y.Unmap()
	if x == y {
		return true
	}
	if x == netip.IPv6Unspecified() || y == netip.IPv6Unspecified() {
		return true
	}
	return x.Is4() == y.Is4() && (x.IsUnspecified() || y.IsUnspecified())
}

type Action struct {
	DeleteServices   bool   `json:"delete_services,omitempty" doc:"仅卸载时使用；成功后删除全部关联服务及凭证，默认保留"`
	RestorePrevious  bool   `json:"restore_previous"`
	RotateServiceID  string `json:"rotate_service_id"`
	Operation        string `json:"operation"`
	Version          string `json:"version"`
	DraftVersion     int64  `json:"draft_version"`
	IdempotencyKey   string `json:"idempotency_key"`
	Confirm          bool   `json:"confirm"`
	AllowUnreachable bool   `json:"allow_unreachable"`
}

type Grant struct {
	UserID    string `json:"user_id"`
	CanManage bool   `json:"can_manage"`
	CanExport bool   `json:"can_export"`
}

type Connection struct {
	ServiceID            string `json:"service_id"`
	Name                 string `json:"name"`
	URL                  string `json:"url"`
	Revision             int64  `json:"revision"`
	RuntimeStatus        string `json:"runtime_status"`
	ExternalConnectivity string `json:"external_connectivity"`
}
