package subscription

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestRulesAndExplicitFormat(t *testing.T) {
	rules := []Rule{
		{ID: "first", Format: Mihomo, Enabled: true, Conditions: []Condition{{Kind: "contains", Pattern: "Clash-Verge"}}},
		{ID: "second", Format: SingBox, Enabled: true, Conditions: []Condition{{Kind: "regex", Pattern: `sing-box/[0-9]+`}}},
		{ID: "disabled", Format: Loon, Conditions: []Condition{{Kind: "contains", Pattern: "loon"}}},
	}
	format, rule, err := SelectFormat(rules, "CLASH-VERGE/1 sing-box/2", "")
	if err != nil || format != Mihomo || rule != "first" {
		t.Fatalf("priority and case-insensitivity: %q %q %v", format, rule, err)
	}
	format, rule, err = SelectFormat(rules, "unknown", SingBox)
	if err != nil || format != SingBox || rule != "second" {
		t.Fatalf("explicit override: %q %q %v", format, rule, err)
	}
	if _, _, err = SelectFormat(rules, "loon/1", ""); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("disabled rule matched: %v", err)
	}
	if _, _, err = SelectFormat(rules, "anything", Loon); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("disabled format override allowed: %v", err)
	}
	if err = ValidateRule(RuleEdit{Name: "规则", TemplateID: Mihomo, Enabled: true, Conditions: []Condition{{Kind: "regex", Pattern: "["}}}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid regex accepted: %v", err)
	}
}

func sampleNode() ClientNode {
	return ClientNode{ServiceRef: ServiceRef{NodeID: "node", EngineID: "engine", ServiceID: "service"}, Name: "东京 / 服务", Engine: "sing-box", EngineVersion: "1.14.4", Host: "2001:db8::2", Port: 443, UUID: "bf000d23-0752-40b4-affe-68f7707a9661", ServerName: "example.com", PublicKey: "public-key", ShortID: "0123456789abcdef"}
}

func TestRenderSingBoxRoutingAndSecrets(t *testing.T) {
	n := sampleNode()
	b, contentType, err := Render(SingBox, 7890, []ClientNode{n})
	if err != nil || contentType != "application/json; charset=utf-8" {
		t.Fatalf("render: %q %v", contentType, err)
	}
	var config struct {
		Outbounds []struct {
			Type       string   `json:"type"`
			Tag        string   `json:"tag"`
			Outbounds  []string `json:"outbounds"`
			Server     string   `json:"server"`
			ServerPort int      `json:"server_port"`
			UUID       string   `json:"uuid"`
			Network    string   `json:"network"`
		} `json:"outbounds"`
		Route struct {
			Final string `json:"final"`
			Rules []struct {
				Private  bool   `json:"ip_is_private"`
				Outbound string `json:"outbound"`
			} `json:"rules"`
		} `json:"route"`
	}
	if err := json.Unmarshal(b, &config); err != nil {
		t.Fatal(err)
	}
	if len(config.Outbounds) != 3 || config.Outbounds[0].Type != "selector" || config.Outbounds[0].Outbounds[0] != n.Name || config.Outbounds[2].Server != n.Host || config.Outbounds[2].UUID != n.UUID || config.Outbounds[2].Network != "tcp" || config.Route.Final != selectorName || len(config.Route.Rules) != 1 || !config.Route.Rules[0].Private || config.Route.Rules[0].Outbound != "direct" {
		t.Fatalf("incorrect configuration: %s", b)
	}
	if strings.Contains(string(b), "private_key") {
		t.Fatal("private key field appeared in client output")
	}
	masked, err := json.Marshal(n)
	if err != nil || strings.Contains(string(masked), n.UUID) {
		t.Fatal("internal node accidentally serializes its UUID")
	}
}

func TestRenderEscapesNamesAndUsesStableCollisionSuffix(t *testing.T) {
	a, b := sampleNode(), sampleNode()
	a.Name = "节点,一 = [规则]"
	b.Name = a.Name
	b.ServiceID = "another"
	names := clientNames([]ClientNode{a, b})
	if names[0] == names[1] || strings.ContainsAny(names[0], ",=[]") || names[0] != clientNames([]ClientNode{a, b})[0] {
		t.Fatalf("unsafe or unstable names: %q", names)
	}
	loon, _, err := Render(Loon, 7890, []ClientNode{a, b})
	if err != nil || strings.Count(string(loon), "[Rule]") != 1 || !strings.Contains(string(loon), "FINAL,"+selectorName) || !strings.Contains(string(loon), "udp=false") || !strings.Contains(string(loon), "udp-fallback-mode = REJECT") {
		t.Fatalf("Loon output: %s %v", loon, err)
	}
	mihomo, _, err := Render(Mihomo, 7890, []ClientNode{a, b})
	if err != nil || !strings.Contains(string(mihomo), "allow-lan: false") || !strings.Contains(string(mihomo), "\"MATCH,"+selectorName+"\"") {
		t.Fatalf("Mihomo output: %s %v", mihomo, err)
	}
}

func TestXrayClientCompatibilityBoundary(t *testing.T) {
	n := sampleNode()
	n.Engine = "xray"
	for _, tc := range []struct {
		version string
		mihomo  bool
		singbox bool
	}{{"26.7.10", true, true}, {"26.7.11", false, true}, {"26.9.7", false, true}, {"26.9.8", false, false}, {"26.10.31", false, false}, {"unknown", false, false}} {
		n.EngineVersion = tc.version
		if got := Compatible(SingBox, n); got != tc.singbox {
			t.Fatalf("version %s allowed=%v", tc.version, got)
		}
		if got := Compatible(Mihomo, n); got != tc.mihomo {
			t.Fatalf("Mihomo version %s allowed=%v", tc.version, got)
		}
	}
	if _, _, err := Render(SingBox, 7890, []ClientNode{n}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("incompatible node accepted: %v", err)
	}
	if _, _, err := Render(Mihomo, 7890, []ClientNode{n}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("incompatible Mihomo node accepted: %v", err)
	}
}
