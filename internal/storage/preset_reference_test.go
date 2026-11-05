package storage

import (
	"context"
	"errors"
	"github.com/vioira/viorka/internal/proxy"
	"testing"
)

func TestUnsupportedReferenceCannotChangeDraft(t *testing.T) {
	s := engineFixture(t)
	ctx := context.Background()
	p, err := s.CreateProtocolPreset(ctx, "admin", proxy.PresetConfig{Name: "XHTTP", Protocol: "vless", Port: 443, Transport: "xhttp", Path: "/", Security: "reality", Site: "external", Target: "example.com:443", ServerName: "example.com", Fingerprint: "chrome"})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"sing", "xray"} {
		before, err := s.Engine(ctx, "admin", id)
		if err != nil {
			t.Fatal(err)
		}
		service := sampleService("unsupported", 8443)
		service.PresetID = p.ID
		if _, err = s.SaveEngineDraft(ctx, "admin", id, proxy.Draft{Version: before.Draft.Version, Services: []proxy.Service{service}}); !errors.Is(err, proxy.ErrPresetUnsupported) {
			t.Fatalf("%s accepted unsupported reference: %v", id, err)
		}
		after, err := s.Engine(ctx, "admin", id)
		if err != nil || after.Draft.Version != before.Draft.Version || len(after.Draft.Services) != len(before.Draft.Services) {
			t.Fatal("rejected reference modified the draft")
		}
	}
}
