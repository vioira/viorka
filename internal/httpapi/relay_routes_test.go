package httpapi

import "testing"

func TestRelayResourceAuthorization(t *testing.T) {
	f := setup(t, "operator")
	res := f.request("GET", "/api/v1/relays", nil, false)
	if res.StatusCode != 401 {
		t.Fatal(res.Status, read(res))
	}
	res.Body.Close()
	res = f.request("GET", "/api/v1/relays", nil, true)
	if res.StatusCode != 200 {
		t.Fatal(res.Status, read(res))
	}
	res.Body.Close()
	res = f.request("POST", "/api/v1/relays", map[string]any{}, true)
	if res.StatusCode != 400 {
		t.Fatal("operator draft validation", res.Status, read(res))
	}
	res.Body.Close()
	res = f.request("GET", "/api/v1/relays?landing_engine=not%20an%20id", nil, true)
	if res.StatusCode != 400 {
		t.Fatal(res.Status, read(res))
	}
	res.Body.Close()
	expectStatus(t, f.request("GET", "/api/v1/relay-landings?limit=1", nil, true), 200)
	expectStatus(t, f.request("GET", "/api/v1/relay-landings?limit=21", nil, true), 400)
	expectStatus(t, f.request("POST", "/api/v1/relays/test/publish", map[string]any{"version": 1, "request_key": "test"}, true), 400)
	expectStatus(t, f.request("POST", "/api/v1/relays/test/public-probe", map[string]any{"revision": 1, "host": "example.test", "port": 42}, true), 400)
	expectStatus(t, f.request("POST", "/api/v1/relays/test/checks", map[string]any{"revision": 1, "stage": "public", "outcome": "passed", "method": "manual"}, true), 404)
	expectStatus(t, f.request("POST", "/api/v1/relays/test/public-probe", map[string]any{}, false), 401)
	viewer := setup(t, "viewer")
	expectStatus(t, viewer.request("POST", "/api/v1/relays/test/public-probe", map[string]any{}, true), 403)
	expectStatus(t, viewer.request("GET", "/api/v1/relay-landings", nil, true), 403)
	expectStatus(t, viewer.request("POST", "/api/v1/relays", map[string]any{}, true), 403)
	expectStatus(t, f.request("POST", "/api/v1/relays", map[string]any{}, false), 401)
	res = viewer.request("POST", "/api/v1/relays/test/probe", map[string]any{"version": 1, "request_key": "test"}, true)
	if res.StatusCode != 403 {
		t.Fatal(res.Status, read(res))
	}
	res.Body.Close()
}
