package inventory

import (
	"regexp"
	"strings"

	v1 "github.com/vioira/viorka/protocol/v1"
)

type DomainUpdate struct {
	Value    string
	Expected string
}

// Public DNS hostname in ASCII (including Punycode), without a scheme or port.
var domainLabel = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`)

func NormalizeNodeDomain(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", true
	}
	host := strings.TrimSuffix(raw, ".")
	labels := strings.Split(host, ".")
	if len(host) > 253 || len(labels) < 2 {
		return "", false
	}
	for _, label := range labels {
		if !domainLabel.MatchString(label) {
			return "", false
		}
	}
	// A public DNS suffix starts with a letter. This also excludes IPv4 literals.
	last := labels[len(labels)-1][0]
	if last >= '0' && last <= '9' {
		return "", false
	}
	return strings.ToLower(host), true
}

type NodeSettingsResult struct {
	Domain    *string               `json:"domain,omitempty" maxLength:"253"`
	Billing   *Billing              `json:"billing,omitempty"`
	Telemetry *v1.TelemetrySettings `json:"telemetry,omitempty"`
}
