package httpapi

import (
	"encoding/json"
	"github.com/vioira/viorka/internal/proxy"
	"testing"
)

func TestProtocolPresetHTTP(t *testing.T) {
	f := setup(t, "operator")
	c := proxy.PresetConfig{Name: "VLESS", Protocol: "vless", Port: 443, Transport: "tcp", Security: "reality", Site: "external", Target: "example.com:443", ServerName: "example.com", Fingerprint: "chrome"}
	for _, tc := range []struct {
		method, path  string
		body          any
		authenticated bool
		status        int
	}{
		{"GET", "/api/v1/protocol-presets", nil, false, 401},
		{"POST", "/api/v1/protocol-presets", c, true, 201},
		{"POST", "/api/v1/protocol-presets", c, true, 409},
		{"GET", "/api/v1/protocol-presets?limit=101", nil, true, 400},
		{"GET", "/api/v1/protocol-presets?unknown=1", nil, true, 400},
		{"GET", "/api/v1/protocol-presets?limit=1&limit=2", nil, true, 400},
		{"POST", "/api/v1/protocol-presets", map[string]any{"protocol": "vless", "private_key": "secret"}, true, 400},
	} {
		r := f.request(tc.method, tc.path, tc.body, tc.authenticated)
		if r.StatusCode != tc.status {
			t.Errorf("%s: %d %s", tc.path, r.StatusCode, read(r))
		}
		r.Body.Close()
	}
	r := f.request("GET", "/api/v1/protocol-presets", nil, true)
	defer r.Body.Close()
	var page ProtocolPresetsResponse
	if err := json.NewDecoder(r.Body).Decode(&page); err != nil || len(page.Items) != 1 || !page.Items[0].Referenceable {
		t.Fatal(page, err)
	}
	conflict := f.request("POST", "/api/v1/protocol-presets", c, true)
	var failure struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.NewDecoder(conflict.Body).Decode(&failure); err != nil {
		t.Fatal(err)
	}
	conflict.Body.Close()
	if failure.Code != "protocol_preset_conflict" || failure.Message != "协议配置名称已存在，请使用其他名称" {
		t.Fatal(failure)
	}
	c.Port = 0
	r = f.request("POST", "/api/v1/protocol-presets", c, true)
	defer r.Body.Close()
	if r.StatusCode != 400 {
		t.Fatal(r.StatusCode)
	}
}
func TestProtocolPresetViewerCannotCreate(t *testing.T) {
	f := setup(t, "viewer")
	r := f.request("POST", "/api/v1/protocol-presets", map[string]any{}, true)
	defer r.Body.Close()
	if r.StatusCode != 403 {
		t.Fatal(r.StatusCode)
	}
}
