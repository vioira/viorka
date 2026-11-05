package httpapi

import (
	"encoding/json"
	"github.com/vioira/viorka/internal/proxy"
	"testing"
)

func TestPresetEditHTTPConfirmation(t *testing.T) {
	f := setup(t, "operator")
	c := proxy.PresetConfig{Name: "Editable", Protocol: "vless", Port: 443, Transport: "tcp", Security: "reality", Site: "external", Target: "example.com:443", ServerName: "example.com", Fingerprint: "chrome"}
	response := f.request("POST", "/api/v1/protocol-presets", c, true)
	var p proxy.Preset
	if err := json.NewDecoder(response.Body).Decode(&p); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	path := "/api/v1/protocol-presets/" + p.ID
	response = f.request("GET", path, nil, true)
	var detail proxy.PresetDetail
	if err := json.NewDecoder(response.Body).Decode(&detail); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if detail.ID != p.ID || detail.Digest == "" {
		t.Fatal("missing edit fence", detail)
	}
	edit := proxy.PresetEdit{Config: detail.Config, BaseDigest: detail.Digest}
	edit.Config.Port = 8443
	for _, tc := range []struct {
		method, path string
		body         any
		auth         bool
		status       int
	}{
		{"GET", path, nil, false, 401},
		{"PUT", path, edit, false, 401},
		{"PUT", path, edit, true, 409},
		{"POST", path + "/preview", map[string]any{"unknown": true}, true, 400},
		{"GET", "/api/v1/protocol-presets/missing", nil, true, 404},
	} {
		r := f.request(tc.method, tc.path, tc.body, tc.auth)
		if r.StatusCode != tc.status {
			t.Fatalf("%s %s: %d %s", tc.method, tc.path, r.StatusCode, read(r))
		}
		r.Body.Close()
	}
	response = f.request("POST", path+"/preview", edit, true)
	var preview proxy.PresetPreview
	if err := json.NewDecoder(response.Body).Decode(&preview); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if preview.Confirmation == "" || len(preview.Impacts) != 0 || preview.Before.Port != 443 || preview.Config.Port != 8443 {
		t.Fatal("bad preview", preview)
	}
	edit.Confirmation = preview.Confirmation
	response = f.request("PUT", path, edit, true)
	if response.StatusCode != 200 {
		t.Fatal(response.StatusCode, read(response))
	}
	response.Body.Close()
	response = f.request("PUT", path, edit, true)
	if response.StatusCode != 409 {
		t.Fatal("stale edit accepted", response.StatusCode)
	}
	response.Body.Close()
}
func TestPresetEditViewerDenied(t *testing.T) {
	f := setup(t, "viewer")
	for _, method := range []string{"POST", "PUT"} {
		path := "/api/v1/protocol-presets/missing"
		if method == "POST" {
			path += "/preview"
		}
		r := f.request(method, path, proxy.PresetEdit{}, true)
		if r.StatusCode != 403 {
			t.Fatal(r.StatusCode)
		}
		r.Body.Close()
	}
}
