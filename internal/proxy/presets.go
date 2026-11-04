package proxy

import (
	"encoding/hex"
	"errors"
	"net"
	"strconv"
	"strings"
	"unicode"
)

var ErrPresetUnsupported = errors.New("protocol preset cannot be referenced by this engine")

// PresetConfig contains reusable, non-secret configuration, never node credentials.
type PresetConfig struct {
	Name        string   `json:"name"`
	Protocol    string   `json:"protocol"`
	Port        int      `json:"port"`
	Transport   string   `json:"transport"`
	Security    string   `json:"security"`
	Site        string   `json:"site"`
	Target      string   `json:"target"`
	ShortIDs    []string `json:"short_ids"`
	Fingerprint string   `json:"fingerprint"`
	Certificate string   `json:"certificate"`
	ServerName  string   `json:"server_name"`
	CDNHost     string   `json:"cdn_host"`
	Path        string   `json:"path"`
}
type Preset struct {
	ID            string       `json:"id"`
	Config        PresetConfig `json:"config"`
	CreatedAt     string       `json:"created_at"`
	Referenceable bool         `json:"referenceable"`
}

func ValidatePreset(p PresetConfig) error {
	if len(p.Name) < 1 || len(p.Name) > 128 || strings.TrimSpace(p.Name) != p.Name || strings.IndexFunc(p.Name, unicode.IsControl) >= 0 || p.Protocol != "vless" || p.Port < 1 || p.Port > 65535 {
		return ErrInvalid
	}
	if p.Transport != "xhttp" && p.Transport != "tcp" && p.Transport != "ws" {
		return ErrInvalid
	}
	if p.Security != "reality" && p.Security != "tls" {
		return ErrInvalid
	}
	if p.Transport == "tcp" && p.Security != "reality" || p.Transport == "ws" && p.Security != "tls" {
		return ErrInvalid
	}
	switch p.Fingerprint {
	case "chrome", "firefox", "safari", "edge", "randomized":
	default:
		return ErrInvalid
	}
	if p.ServerName != "" && (!ValidHost(p.ServerName) || net.ParseIP(p.ServerName) != nil) {
		return ErrInvalid
	}
	if p.Security == "reality" {
		if p.Site != "local" && p.Site != "external" || p.Certificate != "" || p.CDNHost != "" {
			return ErrInvalid
		}
		if p.Site == "external" {
			host, port, err := net.SplitHostPort(p.Target)
			n, e := strconv.Atoi(port)
			if err != nil || e != nil || !ValidHost(host) || n < 1 || n > 65535 || p.ServerName == "" {
				return ErrInvalid
			}
		} else if p.Target != "" {
			return ErrInvalid
		}
		if len(p.ShortIDs) > 8 {
			return ErrInvalid
		}
		seen := map[string]bool{}
		for _, id := range p.ShortIDs {
			b, e := hex.DecodeString(id)
			if e != nil || len(b) < 1 || len(b) > 8 || seen[strings.ToLower(id)] {
				return ErrInvalid
			}
			seen[strings.ToLower(id)] = true
		}
	} else {
		if p.Site != "" || p.Target != "" || len(p.ShortIDs) != 0 {
			return ErrInvalid
		}
		if p.Certificate != "letsencrypt" && p.Certificate != "self_signed" {
			return ErrInvalid
		}
		if p.CDNHost != "" && (!ValidHost(p.CDNHost) || net.ParseIP(p.CDNHost) != nil) || p.Certificate == "self_signed" && p.CDNHost == "" {
			return ErrInvalid
		}
	}
	if p.Transport == "tcp" {
		if p.Path != "" {
			return ErrInvalid
		}
	} else if len(p.Path) < 1 || len(p.Path) > 256 || !strings.HasPrefix(p.Path, "/") || strings.ContainsAny(p.Path, "?#") || strings.IndexFunc(p.Path, unicode.IsSpace) >= 0 || strings.IndexFunc(p.Path, unicode.IsControl) >= 0 {
		return ErrInvalid
	}
	return nil
}
func PresetReferenceable(p PresetConfig) bool {
	return ValidatePreset(p) == nil && p.Transport == "tcp" && p.Security == "reality" && p.Site == "external" && p.Fingerprint == "chrome" && len(p.ShortIDs) == 0
}
