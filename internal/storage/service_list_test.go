package storage

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/proxy"
)

func TestProxyServices(t *testing.T) {
	ctx := t.Context()
	s, route, _ := relayFixture(t)
	second := route.Draft.RelayEdit
	second.Name = "备用入口"
	second.Public.Port++
	second.Listen.Port++
	second.Version = 0
	if _, err := s.SaveRelay(ctx, "admin", "", second); err != nil {
		t.Fatal(err)
	}
	task, err := s.PublishRelay(ctx, "admin", route.ID, reviewRelay(route, "test-list"))
	if err != nil {
		t.Fatal(err)
	}
	replyRelay(t, s, task.ID, 1, "running")
	preset, err := s.CreateProtocolPreset(ctx, "admin", proxy.PresetConfig{Name: "备用预设", Protocol: "vless", Port: 7443, Transport: "tcp", Security: "reality", Site: "external", Target: "example.com:443", ServerName: "example.com", Fingerprint: "chrome"})
	if err != nil {
		t.Fatal(err)
	}
	svc := sampleService("one", 7443)
	svc.PresetID = preset.ID
	saveEngine(t, s, "xray", proxy.Draft{Services: []proxy.Service{svc}})
	e, err := s.Engine(ctx, "admin", "realm")
	if err != nil {
		t.Fatal(err)
	}
	manual := route.Draft
	manual.Name = "独立转发"
	manual.Listen.Port += 2
	manual.Public.Port += 2
	e.Draft.Services = append(e.Draft.Services, relayPath{RelayPath: manual}.rule("manual"))
	saveEngine(t, s, "realm", e.Draft)
	list := func(actor string, q proxy.ServiceListQuery) proxy.ServiceList {
		t.Helper()
		page, err := s.ProxyServices(ctx, actor, q)
		if err != nil {
			t.Fatal(err)
		}
		return page
	}
	first := list("admin", proxy.ServiceListQuery{Limit: 1, Selected: "sing/one"})
	if len(first.Items) != 1 || first.Items[0].ID != "realm/manual" || first.NextCursor != "realm/manual" || first.Selected == nil || first.Selected.ID != "sing/one" || len(first.Selected.Relays) != 2 || first.ManagedRelayCount != 1 || first.Counts.All != 4 || first.Counts.Running != 2 {
		t.Fatalf("unexpected first page: %+v", first)
	}
	next := list("admin", proxy.ServiceListQuery{Limit: 1, After: first.NextCursor, Search: "备用入口", Access: "relayed"})
	if len(next.Items) != 1 || next.Items[0].ID != "sing/one" || len(next.Items[0].Relays) != 2 || next.NextCursor != "" || next.Counts != first.Counts {
		t.Fatal(next)
	}
	direct := list("admin", proxy.ServiceListQuery{Limit: 50, Access: "direct", Engine: "xray", Status: "pending", Search: "备用预设"})
	if len(direct.Items) != 1 || direct.Items[0].ID != "xray/one" || len(direct.Items[0].Relays) != 0 || !direct.Items[0].DraftChanged || direct.Items[0].PresetName != preset.Config.Name || direct.Items[0].Service.ListenPort != 7443 {
		t.Fatal(direct)
	}
	blocked := list("viewer", proxy.ServiceListQuery{Limit: 1, Selected: "sing/one"})
	if len(blocked.Items) != 0 || len(blocked.Nodes) != 0 || !blocked.Restricted || blocked.Selected != nil || blocked.Counts.All != 0 {
		t.Fatal(blocked)
	}
	for _, node := range []string{"node", "other"} {
		if err := s.SetEngineGrant(ctx, "admin", node, proxy.Grant{UserID: "operator", CanManage: node == "other"}); err != nil {
			t.Fatal(err)
		}
	}
	limited := list("operator", proxy.ServiceListQuery{Limit: 50, Access: "relayed", Selected: "sing/one"})
	if len(limited.Items) != 0 || limited.Selected == nil || len(limited.Selected.Relays) != 0 || limited.Selected.RelayEligible || limited.ManagedRelayCount != 1 {
		t.Fatal(limited)
	}
	raw, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"vless://", `"private_key"`, `"uuid"`, `"credentials"`} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("ordinary list contains connection credentials")
		}
	}
}
