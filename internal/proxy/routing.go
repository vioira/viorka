package proxy

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/netip"
	"strconv"
	"strings"
	"unicode"
)

type OutboundConfig struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"`
	Server      string `json:"server"`
	ServerPort  uint64 `json:"server_port"`
	Username    string `json:"username,omitempty"`
	Password    string `json:"password,omitempty"`
	Uuid        string `json:"uuid,omitempty"`
	ServerName  string `json:"server_name,omitempty"`
	PublicKey   string `json:"public_key,omitempty"`
	ShortID     string `json:"short_id,omitempty"`
	Flow        string `json:"flow,omitempty"`
	Fingerprint string `json:"fingerprint,omitempty"`
	Tls         bool   `json:"tls,omitempty"`
}
type RouteRule struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Enabled      bool     `json:"enabled"`
	Inbound      []string `json:"inbound,omitempty"`
	Domain       []string `json:"domain,omitempty"`
	DomainSuffix []string `json:"domain_suffix,omitempty"`
	IpCidr       []string `json:"ip_cidr,omitempty"`
	Port         []uint64 `json:"port,omitempty"`
	PortRange    []string `json:"port_range,omitempty"`
	Network      []string `json:"network,omitempty"`
	Outbound     string   `json:"outbound"`
	MatchAll     bool     `json:"match_all"`
}
type Routing struct {
	OutboundIds []string     `json:"outbound_ids"`
	Rules       []*RouteRule `json:"rules"`
	Final       string       `json:"final"`
	Sniff       bool         `json:"sniff"`
}

func routingID(s string) bool {
	if len(s) < 1 || len(s) > 64 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}
func routingName(s string) bool {
	return len(s) > 0 && len(s) <= 128 && strings.TrimSpace(s) == s && strings.IndexFunc(s, unicode.IsControl) < 0
}
func (o OutboundConfig) Validate() error {
	bad := errors.New("invalid outbound configuration")
	if !routingID(o.ID) || o.ID == "direct" || o.ID == "reject" || !routingName(o.Name) || !ValidHost(o.Server) || o.ServerPort < 1 || o.ServerPort > 65535 || len(o.Username) > 256 || len(o.Password) > 1024 {
		return bad
	}
	switch o.Type {
	case "vless":
		if len(o.Uuid) != 36 || o.Uuid[8] != '-' || o.Uuid[13] != '-' || o.Uuid[18] != '-' || o.Uuid[23] != '-' {
			return bad
		}
		if _, e := hex.DecodeString(strings.ReplaceAll(o.Uuid, "-", "")); e != nil {
			return bad
		}
		if !o.Tls {
			if o.Username != "" || o.Password != "" || o.ServerName != "" || o.PublicKey != "" || o.ShortID != "" || o.Flow != "" || o.Fingerprint != "" {
				return bad
			}
			return nil
		}
		key, e := base64.RawURLEncoding.DecodeString(o.PublicKey)
		if e != nil || len(key) != 32 {
			return bad
		}
		sid, e := hex.DecodeString(o.ShortID)
		if e != nil || len(sid) > 8 {
			return bad
		}
		if !ValidHost(o.ServerName) || o.Username != "" || o.Password != "" || !o.Tls || o.Flow != "" && o.Flow != "xtls-rprx-vision" {
			return bad
		}
		switch o.Fingerprint {
		case "chrome", "firefox", "safari", "edge", "randomized":
		default:
			return bad
		}
	case "socks", "http":
		if o.Uuid != "" || o.PublicKey != "" || o.ShortID != "" || o.Flow != "" || o.Fingerprint != "" || o.Type == "socks" && o.Tls || o.ServerName != "" && (!o.Tls || !ValidHost(o.ServerName)) || (o.Username == "") != (o.Password == "") {
			return bad
		}
	default:
		return bad
	}
	return nil
}
func (r Routing) Validate(services []Service) error {
	bad := errors.New("invalid routing configuration")
	if len(r.OutboundIds) > 32 || len(r.Rules) > 128 {
		return bad
	}
	exits := map[string]bool{"direct": true, "reject": true}
	for _, id := range r.OutboundIds {
		if !routingID(id) || exits[id] {
			return bad
		}
		exits[id] = true
	}
	if !exits[r.Final] {
		return bad
	}
	ins := map[string]bool{}
	for _, s := range services {
		if !s.PendingDelete {
			ins[s.ID] = true
		}
	}
	seen := map[string]bool{}
	for _, rule := range r.Rules {
		if rule == nil || !routingID(rule.ID) || seen[rule.ID] || !routingName(rule.Name) || !exits[rule.Outbound] {
			return bad
		}
		seen[rule.ID] = true
		if len(rule.Inbound) > 32 || len(rule.Domain) > 64 || len(rule.DomainSuffix) > 64 || len(rule.IpCidr) > 64 || len(rule.Port) > 64 || len(rule.PortRange) > 64 || len(rule.Network) > 2 {
			return bad
		}
		for _, id := range rule.Inbound {
			if !ins[id] {
				return bad
			}
		}
		for _, a := range append(append([]string{}, rule.Domain...), rule.DomainSuffix...) {
			if !ValidHost(a) {
				return bad
			}
			if _, e := netip.ParseAddr(a); e == nil {
				return bad
			}
		}
		for _, a := range rule.IpCidr {
			if _, e := netip.ParsePrefix(a); e != nil {
				return bad
			}
		}
		for _, p := range rule.Port {
			if p < 1 || p > 65535 {
				return bad
			}
		}
		for _, p := range rule.PortRange {
			v := strings.Split(p, ":")
			if len(v) != 2 {
				return bad
			}
			a, e := strconv.Atoi(v[0])
			b, f := strconv.Atoi(v[1])
			if e != nil || f != nil || a < 1 || b > 65535 || a > b {
				return bad
			}
		}
		for _, n := range rule.Network {
			if n != "tcp" && n != "udp" {
				return bad
			}
		}
		conditions := len(rule.Domain) + len(rule.DomainSuffix) + len(rule.IpCidr) + len(rule.Port) + len(rule.PortRange) + len(rule.Network)
		if conditions == 0 && !rule.MatchAll || conditions > 0 && rule.MatchAll {
			return bad
		}
	}
	return nil
}
