package subscription

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

var (
	ErrInvalid     = errors.New("invalid subscription")
	ErrConflict    = errors.New("subscription conflict")
	ErrForbidden   = errors.New("subscription forbidden")
	ErrNotFound    = errors.New("subscription not found")
	ErrUnsupported = errors.New("unsupported subscription client")
	ErrTemplate    = errors.New("subscription template failed")
	ErrNoServices  = errors.New("no eligible subscription services")
)

const (
	Mihomo  = "mihomo"
	SingBox = "sing-box"
	Loon    = "loon"

	MaxRules      = 100
	MaxConditions = 32
	MaxServices   = 100
	MaxUserAgent  = 1024
)

type Condition struct {
	Kind    string `json:"kind" enum:"contains,regex"`
	Pattern string `json:"pattern" maxLength:"256"`
}

type Rule struct {
	ID         string      `json:"id"`
	Name       string      `json:"name"`
	Format     string      `json:"format" enum:"mihomo,sing-box,loon"`
	TemplateID string      `json:"template_id"`
	Conditions []Condition `json:"conditions" maxItems:"32"`
	Position   int         `json:"position"`
	Version    int64       `json:"version"`
	References int         `json:"references"`
	Enabled    bool        `json:"enabled"`
}

type RuleEdit struct {
	Name               string      `json:"name" maxLength:"128"`
	TemplateID         string      `json:"template_id" maxLength:"128"`
	Conditions         []Condition `json:"conditions" maxItems:"32"`
	Position           int         `json:"position" minimum:"0" maximum:"10000"`
	Version            int64       `json:"version"`
	ExpectedReferences int         `json:"expected_references"`
	Enabled            bool        `json:"enabled"`
	Confirm            bool        `json:"confirm"`
}

type ServiceRef struct {
	NodeID    string `json:"node_id"`
	EngineID  string `json:"engine_id"`
	ServiceID string `json:"service_id"`
}

type ServiceView struct {
	EntryType   string `json:"entry_type"`
	LandingName string `json:"landing_name,omitempty"`
	VerifiedAt  string `json:"verified_at,omitempty"`
	ServiceRef
	NodeName            string   `json:"node_name"`
	Engine              string   `json:"engine"`
	Protocol            string   `json:"protocol"`
	ServiceName         string   `json:"service_name"`
	Status              string   `json:"status"`
	Reason              string   `json:"reason"`
	PublicHost          string   `json:"public_host"`
	PublicPort          int      `json:"public_port"`
	IncompatibleFormats []string `json:"incompatible_formats"`
}

type AccessSummary struct {
	At     string `json:"at"`
	Format string `json:"format"`
	Result string `json:"result"`
}
type Subscription struct {
	LastAccess *AccessSummary `json:"last_access,omitempty"`
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	OwnerID    string         `json:"owner_id"`
	CreatedAt  string         `json:"created_at"`
	UpdatedAt  string         `json:"updated_at"`
	RuleIDs    []string       `json:"rule_ids"`
	Services   []ServiceView  `json:"services"`
	Port       int            `json:"mihomo_port" minimum:"1" maximum:"65535"`
	Version    int64          `json:"version"`
	Revoked    bool           `json:"revoked"`
}

type Edit struct {
	Name     string       `json:"name" maxLength:"128"`
	RuleIDs  []string     `json:"rule_ids" maxItems:"100"`
	Services []ServiceRef `json:"services" maxItems:"100"`
	Reselect []ServiceRef `json:"reselect,omitempty" maxItems:"100"`
	Port     int          `json:"mihomo_port" minimum:"1" maximum:"65535"`
	Version  int64        `json:"version"`
}

type Access struct {
	ID        int64  `json:"id"`
	At        string `json:"at"`
	UserAgent string `json:"user_agent"`
	RuleID    string `json:"rule_id"`
	Format    string `json:"format"`
	Result    string `json:"result"`
}

type RestoreService struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	PublicHost         string `json:"public_host"`
	PublicPort         int    `json:"public_port"`
	Change             string `json:"change"`
	CredentialsChanged bool   `json:"credentials_changed"`
	Confirmed          bool   `json:"confirmed"`
	Enabled            bool   `json:"enabled"`
}

type RestoreChange struct {
	Resource string `json:"resource"`
	Field    string `json:"field"`
	Before   string `json:"before"`
	After    string `json:"after"`
}

type RestoreStatus struct {
	Changes          []RestoreChange  `json:"changes"`
	EngineID         string           `json:"engine_id"`
	EngineName       string           `json:"engine_name"`
	NodeID           string           `json:"node_id"`
	NodeName         string           `json:"node_name"`
	NodeState        string           `json:"node_state"`
	RuntimeStatus    string           `json:"runtime_status"`
	State            string           `json:"state"`
	TaskID           string           `json:"task_id"`
	TaskState        string           `json:"task_state"`
	ErrorCode        string           `json:"error_code"`
	ObservedRevision int64            `json:"observed_revision"`
	DraftNeedsReview bool             `json:"draft_needs_review"`
	Services         []RestoreService `json:"services"`
}

// Rendered is internal response data, never an ordinary JSON API DTO.
type Rendered struct {
	Body        []byte
	ContentType string
}

// ClientNode contains only the client-side credential. The REALITY private key
// remains in encrypted engine storage and must never be added to this type.
type ClientNode struct {
	Relay bool `json:"-"`
	ServiceRef
	Name          string
	Engine        string
	EngineVersion string
	Host          string
	Port          int
	UUID          string `json:"-"`
	ServerName    string
	PublicKey     string
	ShortID       string
}

func ValidFormat(v string) bool { return v == Mihomo || v == SingBox || v == Loon }

func ValidName(v string) bool {
	return len(v) >= 1 && len(v) <= 128 && strings.TrimSpace(v) == v && strings.IndexFunc(v, unicode.IsControl) < 0
}

func ValidateRule(v RuleEdit) error {
	if !ValidName(v.Name) || (v.TemplateID == "" || len(v.TemplateID) > 128) || v.Position < 0 || v.Position > 10000 || v.Version < 0 || v.ExpectedReferences < 0 || len(v.Conditions) > MaxConditions || (v.Enabled && len(v.Conditions) == 0) {
		return ErrInvalid
	}
	seen := make(map[Condition]bool, len(v.Conditions))
	for _, c := range v.Conditions {
		if len(c.Pattern) < 1 || len(c.Pattern) > 256 || strings.TrimSpace(c.Pattern) != c.Pattern || strings.IndexFunc(c.Pattern, unicode.IsControl) >= 0 || seen[c] {
			return ErrInvalid
		}
		seen[c] = true
		switch c.Kind {
		case "contains":
		case "regex":
			if _, err := regexp.Compile("(?i)" + c.Pattern); err != nil {
				return fmt.Errorf("%w: invalid expression", ErrInvalid)
			}
		default:
			return ErrInvalid
		}
	}
	return nil
}

func ValidateEdit(v Edit) error {
	if !ValidName(v.Name) || v.Port < 1 || v.Port > 65535 || v.Version < 0 || len(v.RuleIDs) < 1 || len(v.RuleIDs) > MaxRules || len(v.Services) < 1 || len(v.Services) > MaxServices || len(v.Reselect) > MaxServices || (v.Version == 0 && len(v.Reselect) != 0) {
		return ErrInvalid
	}
	ids := map[string]bool{}
	for _, id := range v.RuleIDs {
		if id == "" || len(id) > 128 || ids[id] {
			return ErrInvalid
		}
		ids[id] = true
	}
	refs := map[ServiceRef]bool{}
	for _, ref := range v.Services {
		if ref.NodeID == "" || ref.EngineID == "" || ref.ServiceID == "" || len(ref.NodeID) > 128 || len(ref.EngineID) > 128 || len(ref.ServiceID) > 64 || refs[ref] {
			return ErrInvalid
		}
		refs[ref] = true
	}
	reselected := map[ServiceRef]bool{}
	for _, ref := range v.Reselect {
		if !refs[ref] || reselected[ref] {
			return ErrInvalid
		}
		reselected[ref] = true
	}
	return nil
}

// SelectFormat expects rules in their persisted priority order. An explicit
// format overrides the User-Agent, but only if an enabled selected rule allows
// that format. User-Agent is not an authentication or device identity signal.
func SelectFormat(rules []Rule, userAgent, format string) (string, string, error) {
	if len(userAgent) > MaxUserAgent {
		userAgent = userAgent[:MaxUserAgent]
	}
	if format != "" {
		if !ValidFormat(format) {
			return "", "", ErrUnsupported
		}
		for _, r := range rules {
			if r.Enabled && r.Format == format {
				return format, r.ID, nil
			}
		}
		return "", "", ErrUnsupported
	}
	for _, r := range rules {
		if !r.Enabled {
			continue
		}
		for _, c := range r.Conditions {
			matched := false
			switch c.Kind {
			case "contains":
				matched = strings.Contains(strings.ToLower(userAgent), strings.ToLower(c.Pattern))
			case "regex":
				rx, err := regexp.Compile("(?i)" + c.Pattern)
				if err != nil {
					return "", "", fmt.Errorf("%w: stored expression is invalid", ErrInvalid)
				}
				matched = rx.MatchString(userAgent)
			default:
				return "", "", ErrInvalid
			}
			if matched {
				return r.Format, r.ID, nil
			}
		}
	}
	return "", "", ErrUnsupported
}
