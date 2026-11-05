package httpapi

import (
	"encoding/json"
	"github.com/vioira/viorka/internal/proxy"
	"testing"
)

func TestPresetReferenceReasonsHTTP(t *testing.T) {
	f := setup(t, "operator")
	c := proxy.PresetConfig{Name: "XHTTP", Protocol: "vless", Port: 443, Transport: "xhttp", Path: "/", Security: "reality", Site: "external", Target: "example.com:443", ServerName: "example.com", Fingerprint: "chrome"}
	r := f.request("POST", "/api/v1/protocol-presets", c, true)
	var created proxy.Preset
	if err := json.NewDecoder(r.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	if r.StatusCode != 201 || created.Referenceable || len(created.ReferenceIssues) != 3 || created.ReferenceIssues["sing-box"] == created.ReferenceIssues["xray"] {
		t.Fatalf("unexpected compatibility: %+v", created)
	}
	r = f.request("GET", "/api/v1/protocol-presets", nil, true)
	defer r.Body.Close()
	var page ProtocolPresetsResponse
	if err := json.NewDecoder(r.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].ReferenceIssues["xray"] != created.ReferenceIssues["xray"] {
		t.Fatal("list lost engine-specific reason")
	}
}
