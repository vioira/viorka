package proxy

import "testing"

func TestPresetCombinations(t *testing.T) {
	base := PresetConfig{Name: "VLESS 443", Protocol: "vless", Port: 443, Transport: "tcp", Security: "reality", Site: "external", Target: "example.com:443", ServerName: "example.com", Fingerprint: "chrome"}
	if ValidatePreset(base) != nil || !PresetReferenceable(base) {
		t.Fatal("supported preset rejected")
	}
	for _, tc := range []struct {
		name                 string
		change               func(*PresetConfig)
		valid, referenceable bool
	}{
		{"xhttp", func(p *PresetConfig) { p.Transport = "xhttp"; p.Path = "/proxy" }, true, false},
		{"websocket reality", func(p *PresetConfig) { p.Transport = "ws"; p.Path = "/" }, false, false},
		{"local", func(p *PresetConfig) { p.Site = "local"; p.Target = "" }, true, false},
		{"ipv6 target", func(p *PresetConfig) { p.Target = "[2001:db8::1]:443" }, true, true},
		{"port", func(p *PresetConfig) { p.Port = 65536 }, false, false},
		{"target port", func(p *PresetConfig) { p.Target = "example.com:0" }, false, false},
		{"missing sni", func(p *PresetConfig) { p.ServerName = "" }, false, false},
		{"short id", func(p *PresetConfig) { p.ShortIDs = []string{"aabb"} }, true, false},
		{"odd short id", func(p *PresetConfig) { p.ShortIDs = []string{"abc"} }, false, false},
		{"duplicate short id", func(p *PresetConfig) { p.ShortIDs = []string{"aa", "AA"} }, false, false},
		{"fingerprint", func(p *PresetConfig) { p.Fingerprint = "unknown" }, false, false},
		{"tls ws", func(p *PresetConfig) {
			p.Transport = "ws"
			p.Path = "/ws"
			p.Security = "tls"
			p.Site = ""
			p.Target = ""
			p.Certificate = "letsencrypt"
		}, true, false},
		{"self signed without cdn", func(p *PresetConfig) {
			p.Transport = "ws"
			p.Path = "/ws"
			p.Security = "tls"
			p.Site = ""
			p.Target = ""
			p.Certificate = "self_signed"
		}, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := base
			tc.change(&p)
			if (ValidatePreset(p) == nil) != tc.valid || PresetReferenceable(p) != tc.referenceable {
				t.Fatalf("unexpected validation for %+v", p)
			}
		})
	}
}
