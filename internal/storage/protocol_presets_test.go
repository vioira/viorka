package storage

import (
	"context"
	"encoding/hex"
	"errors"
	"github.com/vioira/viorka/internal/proxy"
	v1 "github.com/vioira/viorka/protocol/v1"
	"net/url"
	"reflect"
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
	if len(p.Config.ShortIDs) != 2 || p.Config.ShortIDs[0] == p.Config.ShortIDs[1] {
		t.Fatalf("expected two distinct saved short IDs: %+v", p.Config.ShortIDs)
	}
	for _, id := range p.Config.ShortIDs {
		b, err := hex.DecodeString(id)
		if err != nil || len(b) != 8 {
			t.Fatalf("invalid generated short ID: %q", id)
		}
	}
	if _, err = s.CreateProtocolPreset(ctx, "admin", c); !errors.Is(err, proxy.ErrConflict) {
		t.Fatal(err)
	}
	items, err := s.ProtocolPresets(ctx, "viewer", "", 1)
	if err != nil || len(items) != 1 || items[0].ID != p.ID || !items[0].Referenceable || items[0].Config.Target != c.Target {
		t.Fatalf("%+v %v", items, err)
	}
	if !reflect.DeepEqual(items[0].Config.ShortIDs, p.Config.ShortIDs) {
		t.Fatal("saved short IDs changed on read")
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

func TestPresetShortIDsReachAllServicesAndSurviveRotation(t *testing.T) {
	for _, ids := range [][]string{nil, {"ab12", "0123456789abcdef"}} {
		s := engineFixture(t)
		ctx := context.Background()
		p, err := s.CreateProtocolPreset(ctx, "admin", proxy.PresetConfig{Name: "Shared", Protocol: "vless", Port: 443, Transport: "tcp", Security: "reality", Site: "external", Target: "example.com:443", ServerName: "example.com", Fingerprint: "chrome", ShortIDs: ids})
		if err != nil {
			t.Fatal(err)
		}
		services := []proxy.Service{sampleService("first", 8443), sampleService("second", 9443)}
		for i := range services {
			services[i].PresetID = p.ID
			port := services[i].ListenPort
			services[i].PortOverride = &port
		}
		d := saveEngine(t, s, "sing", proxy.Draft{Services: services})
		first := actionEngine(t, s, "sing", "initial", "engine.apply", d.Version)
		for _, service := range first.Engine.Services {
			if !reflect.DeepEqual(service.ShortIds, p.Config.ShortIDs) {
				t.Fatalf("task lost preset short IDs: %+v", service.ShortIds)
			}
		}
		if first.Engine.Services[0].PrivateKey == first.Engine.Services[1].PrivateKey || first.Engine.Services[0].Uuid == first.Engine.Services[1].Uuid {
			t.Fatal("service credentials must remain independent")
		}
		replyEngine(t, s, first, "running")
		links, err := s.EngineConnections(ctx, "admin", "sing")
		if err != nil || len(links) != 2 {
			t.Fatalf("connections: %+v %v", links, err)
		}
		for _, link := range links {
			u, err := url.Parse(link.URL)
			if err != nil || u.Query().Get("sid") != p.Config.ShortIDs[0] {
				t.Fatal("connection must select a configured short ID")
			}
		}
		e, err := s.Engine(ctx, "admin", "sing")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.EngineAction(ctx, "admin", "sing", proxy.Action{Operation: "engine.apply", DraftVersion: e.Draft.Version, IdempotencyKey: "rotate", RotateServiceID: "first", Confirm: true}); err != nil {
			t.Fatal(err)
		}
		rotated, err := s.ClaimEngines(ctx, "node")
		if err != nil || rotated == nil {
			t.Fatal("rotation dispatch missing", err)
		}
		for _, service := range rotated.Engine.Services {
			if !reflect.DeepEqual(service.ShortIds, p.Config.ShortIDs) {
				t.Fatal("rotation changed shared preset short IDs")
			}
		}
		if rotated.Engine.Services[0].PrivateKey == first.Engine.Services[0].PrivateKey {
			t.Fatal("rotation did not replace private key")
		}
	}
}

func TestLegacyEngineCapabilityCannotExecute(t *testing.T) {
	for _, capability := range []string{"engine.manage.v1", "engine.manage.v2"} {
		t.Run(capability, func(t *testing.T) {
			s := engineFixture(t)
			ctx := context.Background()
			if err := s.Online(ctx, "node", v1.Hello{OS: "linux", Arch: "amd64", Capabilities: []string{capability}}); err != nil {
				t.Fatal(err)
			}
			if _, err := s.EngineAction(ctx, "admin", "sing", proxy.Action{Operation: "engine.start", IdempotencyKey: "legacy", Confirm: true}); !errors.Is(err, proxy.ErrUnavailable) {
				t.Fatalf("legacy Agent accepted new engine task: %v", err)
			}
		})
	}
}

func TestProtocolPresetExplicitShortIDsAndTLS(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	c := proxy.PresetConfig{Name: "Explicit", Protocol: "vless", Port: 443, Transport: "tcp", Security: "reality", Site: "external", Target: "example.com:443", ServerName: "example.com", Fingerprint: "chrome", ShortIDs: []string{"aabb", "1234567890abcdef"}}
	p, err := s.CreateProtocolPreset(ctx, "admin", c)
	if err != nil || !reflect.DeepEqual(p.Config.ShortIDs, c.ShortIDs) {
		t.Fatalf("explicit short IDs were not preserved: %+v %v", p, err)
	}
	c.Name = "TLS"
	c.Transport, c.Security, c.Certificate, c.Path = "ws", "tls", "letsencrypt", "/"
	c.Site, c.Target, c.ShortIDs = "", "", nil
	p, err = s.CreateProtocolPreset(ctx, "admin", c)
	if err != nil || p.Config.ShortIDs == nil || len(p.Config.ShortIDs) != 0 {
		t.Fatalf("TLS must retain an empty short ID list: %+v %v", p, err)
	}
}
