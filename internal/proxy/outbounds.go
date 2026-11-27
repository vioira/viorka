package proxy

import (
	"encoding/base64"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"

	v1 "github.com/vioira/viorka/protocol/v1"
)

type Outbound struct {
	ID          string         `json:"id"`
	Config      OutboundConfig `json:"config"`
	Version     int64          `json:"version"`
	HasPassword bool           `json:"has_password"`
	HasUUID     bool           `json:"has_uuid"`
	References  int            `json:"references"`
}
type OutboundEdit struct {
	Config       OutboundConfig `json:"config"`
	Version      int64          `json:"version"`
	Confirmation string         `json:"confirmation"`
}
type OutboundImpact struct {
	NodeID               string `json:"node_id"`
	NodeName             string `json:"node_name"`
	EngineID             string `json:"engine_id"`
	State                string `json:"state"`
	DraftOnly            bool   `json:"draft_only"`
	RequiresAgentUpgrade bool   `json:"requires_agent_upgrade,omitempty"`
}
type OutboundPreview struct {
	Impacts      []OutboundImpact `json:"impacts"`
	Confirmation string           `json:"confirmation"`
}

// ParseOutboundLink never fetches the supplied URL. Unsupported query keys are rejected.
func ParseOutboundLink(raw string) (OutboundConfig, error) {
	bad := OutboundConfig{}
	if len(raw) > 8192 {
		return bad, ErrInvalid
	}
	u, e := url.Parse(strings.TrimSpace(raw))
	if e == nil && u.Scheme == "ss" {
		return parseShadowsocks(u)
	}
	if e != nil || u.Scheme != "vless" || u.User == nil || u.Path != "" && u.Path != "/" || u.Opaque != "" {
		return bad, ErrInvalid
	}
	if _, ok := u.User.Password(); ok {
		return bad, ErrInvalid
	}
	q, e := url.ParseQuery(u.RawQuery)
	if e != nil {
		return bad, ErrInvalid
	}
	allowed := map[string]bool{"type": true, "security": true, "encryption": true, "flow": true, "sni": true, "fp": true, "pbk": true, "sid": true, "headerType": true}
	for k, v := range q {
		if len(v) != 1 {
			return bad, ErrInvalid
		}
		// 3x-ui also exports client options outside the sing-box outbound model.
		switch k {
		case "spx":
			if q.Get("security") != "reality" || !strings.HasPrefix(v[0], "/") || strings.IndexFunc(v[0], unicode.IsControl) >= 0 {
				return bad, ErrInvalid
			}
		case "support-x25519mlkem768":
			if q.Get("security") != "reality" || (v[0] != "true" && v[0] != "false") {
				return bad, ErrInvalid
			}
		default:
			if !allowed[k] {
				return bad, ErrInvalid
			}
		}
	}
	if q.Get("security") != "" && q.Get("security") != "none" && q.Get("security") != "reality" || q.Get("type") != "" && q.Get("type") != "tcp" && q.Get("type") != "raw" || q.Get("encryption") != "" && q.Get("encryption") != "none" || q.Get("headerType") != "" && q.Get("headerType") != "none" {
		return bad, ErrInvalid
	}
	port, e := strconv.Atoi(u.Port())
	if e != nil || port < 1 || port > 65535 {
		return bad, ErrInvalid
	}
	name := u.Fragment
	if name == "" {
		name = u.Hostname()
	}
	fp := q.Get("fp")
	if fp == "" && q.Get("security") == "reality" {
		fp = "chrome"
	}
	c := OutboundConfig{ID: "import", Name: name, Type: "vless", Server: u.Hostname(), ServerPort: uint64(port), Uuid: u.User.Username(), Tls: q.Get("security") == "reality", ServerName: q.Get("sni"), PublicKey: q.Get("pbk"), ShortID: q.Get("sid"), Flow: q.Get("flow"), Fingerprint: fp}
	if c.Validate() != nil {
		return bad, ErrInvalid
	}
	c.ID = ""
	return c, nil
}

var (
	ErrShadowsocksUnavailable = errors.New("agent lacks Shadowsocks outbound capability")
	ErrOutboundPlugin         = errors.New("outbound plugin unsupported")
	ErrOutboundMethod         = errors.New("outbound encryption method unsupported")
	ErrOutboundKey            = errors.New("invalid Shadowsocks key")
)

func parseShadowsocks(u *url.URL) (OutboundConfig, error) {
	var empty OutboundConfig
	if u.User == nil || u.EscapedPath() != "" && u.EscapedPath() != "/" {
		return empty, ErrInvalid
	}
	if u.Query().Has("plugin") {
		return empty, ErrOutboundPlugin
	}
	if u.RawQuery != "" || u.ForceQuery {
		return empty, ErrInvalid
	}
	method := u.User.Username()
	password, plain := u.User.Password()
	if !plain {
		encoding := base64.RawURLEncoding.Strict()
		if strings.HasSuffix(method, "=") {
			encoding = base64.URLEncoding.Strict()
		}
		raw, err := encoding.DecodeString(method)
		if err != nil || strings.ContainsAny(method, "\r\n") || !utf8.Valid(raw) {
			return empty, ErrInvalid
		}
		var ok bool
		method, password, ok = strings.Cut(string(raw), ":")
		if !ok || strings.HasPrefix(method, "2022-") {
			return empty, ErrInvalid
		}
	}
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		return empty, ErrInvalid
	}
	name := u.Fragment
	if name == "" {
		name = u.Hostname()
	}
	c := OutboundConfig{ID: "import", Type: "shadowsocks", Name: name, Server: u.Hostname(), ServerPort: uint64(port), Method: method, Password: password}
	if v1.ShadowsocksKeySize(method) < 0 {
		return empty, ErrOutboundMethod
	}
	if !v1.ValidShadowsocksPassword(method, password) && v1.ShadowsocksKeySize(method) > 0 {
		return empty, ErrOutboundKey
	}
	if !utf8.ValidString(password) || !utf8.ValidString(name) || c.Validate() != nil {
		return empty, ErrInvalid
	}
	c.ID = ""
	return c, nil
}
