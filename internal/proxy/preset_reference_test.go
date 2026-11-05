package proxy

import (
	"strings"
	"testing"
)

func TestPresetReferenceIssues(t *testing.T) {
	base := PresetConfig{Name: "Shared", Protocol: "vless", Port: 443, Transport: "tcp", Security: "reality", Site: "external", Target: "example.com:443", ServerName: "example.com", Fingerprint: "chrome", ShortIDs: []string{"aabb"}}
	for _, tc := range []struct {
		name, engine, reason string
		change               func(*PresetConfig)
	}{
		{"sing supported", "sing-box", "", func(p *PresetConfig) {}},
		{"xray supported", "xray", "", func(p *PresetConfig) {}},
		{"sing xhttp", "sing-box", "不支持 XHTTP", func(p *PresetConfig) { p.Transport = "xhttp"; p.Path = "/" }},
		{"xray xhttp", "xray", "执行链路尚未接入 XHTTP", func(p *PresetConfig) { p.Transport = "xhttp"; p.Path = "/" }},
		{"realm", "realm", "仅支持 TCP 转发", func(p *PresetConfig) {}},
		{"local site", "xray", "外部 REALITY", func(p *PresetConfig) { p.Site = "local"; p.Target = "" }},
		{"fingerprint", "sing-box", "Chrome 指纹", func(p *PresetConfig) { p.Fingerprint = "firefox" }},
		{"missing ids", "xray", "缺少 Short ID", func(p *PresetConfig) { p.ShortIDs = nil }},
		{"unknown engine", "other", "尚未接入协议配置", func(p *PresetConfig) {}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := base
			tc.change(&p)
			reason := PresetReferenceIssue(tc.engine, p)
			if tc.reason == "" && reason != "" || tc.reason != "" && !strings.Contains(reason, tc.reason) {
				t.Fatalf("unexpected reason %q", reason)
			}
			if ValidEngine(tc.engine) && PresetReferenceIssues(p)[tc.engine] != reason {
				t.Fatal("reported capability differs from validation")
			}
		})
	}
}
