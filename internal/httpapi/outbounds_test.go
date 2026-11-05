package httpapi

import (
	"encoding/json"
	"github.com/vioira/viorka/internal/proxy"

	"testing"
)

func TestOutboundHTTP(t *testing.T) {
	f := setup(t, "operator")
	edit := proxy.OutboundEdit{Config: proxy.OutboundConfig{Name: "Exit", Type: "socks", Server: "example.com", ServerPort: 1080, Username: "user", Password: "secret"}}
	for _, tc := range []struct {
		method, path  string
		body          any
		authenticated bool
		status        int
	}{{"GET", "/api/v1/outbounds", nil, false, 401}, {"POST", "/api/v1/outbounds", edit, true, 201}, {"POST", "/api/v1/outbounds", edit, true, 409}, {"GET", "/api/v1/outbounds?limit=101", nil, true, 400}, {"GET", "/api/v1/outbounds?unknown=x", nil, true, 400}, {"POST", "/api/v1/outbounds/parse", OutboundLinkRequest{Link: "vless://invalid"}, true, 400}, {"POST", "/api/v1/outbounds", map[string]any{"config": edit.Config, "override": true}, true, 400}, {"PUT", "/api/v1/engines/missing/draft", map[string]any{"version": 0, "services": []any{}, "outbounds": []any{edit.Config}}, true, 400}} {
		r := f.request(tc.method, tc.path, tc.body, tc.authenticated)
		if r.StatusCode != tc.status {
			t.Errorf("%s: %d %s", tc.path, r.StatusCode, read(r))
		}
		r.Body.Close()
	}
	r := f.request("GET", "/api/v1/outbounds", nil, true)
	defer r.Body.Close()
	var page OutboundsResponse
	if err := json.NewDecoder(r.Body).Decode(&page); err != nil || len(page.Items) != 1 || page.Items[0].Config.Password != "" || !page.Items[0].HasPassword {
		t.Fatal("invalid redacted response", err)
	}
	o := page.Items[0]
	edit.Config = o.Config
	edit.Version = o.Version
	edit.Config.Server = "new.example.com"
	r = f.request("PUT", "/api/v1/outbounds/"+o.ID, edit, true)
	if r.StatusCode != 409 {
		t.Fatal("missing confirmation accepted", r.StatusCode)
	}
	r.Body.Close()
	r = f.request("POST", "/api/v1/outbounds/"+o.ID+"/preview", edit, true)
	var p proxy.OutboundPreview
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil || r.StatusCode != 200 {
		t.Fatal(err, r.StatusCode)
	}
	r.Body.Close()
	edit.Confirmation = p.Confirmation
	r = f.request("PUT", "/api/v1/outbounds/"+o.ID, edit, true)
	if r.StatusCode != 200 {
		t.Fatal(read(r))
	}
	r.Body.Close()
}
func TestOutboundViewerCannotWrite(t *testing.T) {
	f := setup(t, "viewer")
	for _, path := range []string{"/api/v1/outbounds", "/api/v1/outbounds/parse"} {
		r := f.request("POST", path, map[string]any{}, true)
		if r.StatusCode != 403 {
			t.Fatal(r.StatusCode)
		}
		r.Body.Close()
	}
}
