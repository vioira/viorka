package storage

import (
	"context"
	"errors"
	"github.com/vioira/viorka/internal/proxy"
	"testing"
)

func TestProtocolPresetPersistenceAndReference(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	c := proxy.PresetConfig{Name: "VLESS", Protocol: "vless", Port: 443, Transport: "tcp", Security: "reality", Site: "external", Target: "example.com:443", ServerName: "example.com", Fingerprint: "chrome"}
	if _, err := s.CreateProtocolPreset(ctx, "viewer", c); !errors.Is(err, proxy.ErrForbidden) {
		t.Fatal(err)
	}
	p, err := s.CreateProtocolPreset(ctx, "operator", c)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CreateProtocolPreset(ctx, "admin", c); !errors.Is(err, proxy.ErrConflict) {
		t.Fatal(err)
	}
	items, err := s.ProtocolPresets(ctx, "viewer", "", 1)
	if err != nil || len(items) != 1 || items[0].ID != p.ID || !items[0].Referenceable || items[0].Config.Target != c.Target {
		t.Fatalf("%+v %v", items, err)
	}
	items, err = s.ProtocolPresets(ctx, "viewer", p.ID, 1)
	if err != nil || len(items) != 0 {
		t.Fatal(items, err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT count(*) FROM audit_logs WHERE action='protocol_preset.create'`).Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	service := sampleService("preset-service", 443)
	service.PresetID = p.ID
	d, err := s.SaveEngineDraft(ctx, "admin", "sing", proxy.Draft{Services: []proxy.Service{service}})
	if err != nil || d.Services[0].PresetID != p.ID {
		t.Fatal(d, err)
	}
	if _, err = s.SaveEngineDraft(ctx, "operator", "xray", proxy.Draft{Services: []proxy.Service{service}}); !errors.Is(err, proxy.ErrForbidden) {
		t.Fatal(err)
	}
	c.Name = "XHTTP"
	c.Transport = "xhttp"
	c.Path = "/"
	unsupported, err := s.CreateProtocolPreset(ctx, "admin", c)
	if err != nil {
		t.Fatal(err)
	}
	service.PresetID = unsupported.ID
	if _, err = s.SaveEngineDraft(ctx, "admin", "xray", proxy.Draft{Services: []proxy.Service{service}}); !errors.Is(err, proxy.ErrPresetUnsupported) {
		t.Fatal(err)
	}
	service.PresetID = "missing"
	if _, err = s.SaveEngineDraft(ctx, "admin", "xray", proxy.Draft{Services: []proxy.Service{service}}); err == nil {
		t.Fatal("missing preset accepted")
	}
}
