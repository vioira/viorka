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
	ID              string            `json:"id"`
	Config          PresetConfig      `json:"config"`
	CreatedAt       string            `json:"created_at"`
	Referenceable   bool              `json:"referenceable"`
	ReferenceIssues map[string]string `json:"reference_issues"`
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

// PresetReferenceIssue describes the current Panel execution adapter, not just
// the upstream engine's theoretical capabilities. Empty means referenceable.
func PresetReferenceIssue(engine string, p PresetConfig) string {
	if engine == "realm" {
		return "Realm 仅支持 TCP 转发，不能引用 VLESS 协议配置"
	}
	if engine != "sing-box" && engine != "xray" {
		return "当前引擎尚未接入协议配置"
	}
	if ValidatePreset(p) != nil {
		return "协议配置参数无效，请重新创建配置"
	}
	if p.Transport == "xhttp" && engine == "sing-box" {
		return "sing-box 不支持 XHTTP 传输"
	}
	if p.Transport == "xhttp" {
		return "当前节点执行链路尚未接入 XHTTP 传输"
	}
	if p.Transport == "ws" {
		return "当前节点执行链路尚未接入 WebSocket 传输"
	}
	if p.Security != "reality" {
		return "当前节点执行链路尚未接入 TLS 证书配置"
	}
	if p.Site != "external" {
		return "当前节点执行链路仅支持外部 REALITY 握手目标"
	}
	if p.Fingerprint != "chrome" {
		return "当前连接导出仅支持 Chrome 指纹"
	}
	if len(p.ShortIDs) == 0 {
		return "协议配置缺少 Short ID，请重新创建配置"
	}
	return ""
}
func PresetReferenceIssues(p PresetConfig) map[string]string {
	return map[string]string{
		"sing-box": PresetReferenceIssue("sing-box", p),
		"xray":     PresetReferenceIssue("xray", p),
		"realm":    PresetReferenceIssue("realm", p),
	}
}
func PresetReferenceable(p PresetConfig) bool {
	return PresetReferenceIssue("sing-box", p) == "" || PresetReferenceIssue("xray", p) == ""
}

// ResolvePreset applies inheritance without inferring overrides from equal values.
func ResolvePreset(service Service, c PresetConfig) Service {
	service.ListenPort = c.Port
	if service.PortOverride != nil {
		service.ListenPort = *service.PortOverride
	}
	service.ServerName = c.ServerName
	if service.SNIOverride != nil {
		service.ServerName = *service.SNIOverride
	}
	host, port, _ := net.SplitHostPort(c.Target)
	service.TargetHost = host
	service.TargetPort, _ = strconv.Atoi(port)
	return service
}

type PresetEdit struct {
	Config       PresetConfig `json:"config"`
	BaseDigest   string       `json:"base_digest"`
	Confirmation string       `json:"confirmation"`
}
type PresetDetail struct {
	Preset
	Digest string `json:"digest"`
}
type PresetImpact struct {
	EngineID       string                `json:"engine_id"`
	NodeID         string                `json:"node_id"`
	NodeName       string                `json:"node_name"`
	NodeState      string                `json:"node_state"`
	Engine         string                `json:"engine"`
	RunIntent      string                `json:"run_intent"`
	Services       []PresetServiceImpact `json:"services"`
	SharedServices []string              `json:"shared_services"`
	Changed        bool                  `json:"changed"`
	DraftOnly      bool                  `json:"draft_only"`
	Issue          string                `json:"issue"`
}
type PresetServiceImpact struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	PortOverridden bool   `json:"port_overridden"`
	SNIOverridden  bool   `json:"sni_overridden"`
	BeforePort     int    `json:"before_port"`
	AfterPort      int    `json:"after_port"`
	BeforeSNI      string `json:"before_sni"`
	AfterSNI       string `json:"after_sni"`
}
type PresetPreview struct {
	Before       PresetConfig   `json:"before"`
	Config       PresetConfig   `json:"config"`
	Confirmation string         `json:"confirmation"`
	Impacts      []PresetImpact `json:"impacts"`
}

var ErrPresetStale = errors.New("protocol preset preview is stale")
var ErrPresetLimit = errors.New("too many referenced engines for one update")
