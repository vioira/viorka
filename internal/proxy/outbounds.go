package proxy

import (
	"net/url"
	"strconv"
	"strings"
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
	NodeID    string `json:"node_id"`
	NodeName  string `json:"node_name"`
	EngineID  string `json:"engine_id"`
	State     string `json:"state"`
	DraftOnly bool   `json:"draft_only"`
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
		if !allowed[k] || len(v) != 1 {
			return bad, ErrInvalid
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
