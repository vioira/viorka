package httpapi

import (
	"bufio"
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestStatusPublicationVisibility(t *testing.T) {
	f := setup(t, "admin")
	id, _ := f.enroll()
	other, _ := f.enroll()
	get := func(path string, code int) string {
		t.Helper()
		res := f.request("GET", path, nil, false)
		body := read(res)
		if res.StatusCode != code {
			t.Fatalf("%s: %d %s", path, res.StatusCode, body)
		}
		return body
	}
	get("/api/v1/status", 404)
	get("/api/v1/settings/status-page", 401)
	ctx := t.Context()
	sampleAt := time.Now().UTC().Add(-10 * time.Minute).Truncate(30 * time.Second)
	cpu := 42.25
	bucket := monitoring.NewBucket(id, sampleAt)
	if err := bucket.AddFast(&v1.TelemetryFast{SampledAt: sampleAt, CPUPercent: &cpu}); err != nil {
		t.Fatal(err)
	}
	if err := f.store.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{{Node: id, Buckets: []monitoring.Bucket{bucket}}}, time.Now()); err != nil {
		t.Fatal(err)
	}
	cat := inventory.CategoryCatalog{Revision: 1, Items: []inventory.NodeCategory{{ID: "private", Kind: "group", Name: "internal billing", Shared: false}, {ID: "public", Kind: "tag", Name: "Amsterdam", Shared: true}}}
	expectStatus(t, f.request("PUT", "/api/v1/node-categories", cat, true), 204)
	for i, action := range []string{"group", "add"} {
		input := inventory.CategoryAssignment{Revision: int64(i + 2), Nodes: []string{id}, Action: action, Category: cat.Items[i].ID}
		expectStatus(t, f.request("PATCH", "/api/v1/node-categories/members", input, true), 204)
	}
	p := inventory.StatusPublication{Revision: 1, Enabled: true, Nodes: []inventory.PublishedNode{{ID: id, Alias: "Public alias"}}}
	preview := decodeResponse[StatusPage](t, f.request("POST", "/api/v1/settings/status-page/preview", p, true), 200)
	if len(preview.Nodes) != 1 || preview.Nodes[0].Alias != "Public alias" {
		t.Fatal(preview)
	}
	get("/api/v1/status", 404)
	expectStatus(t, f.request("PUT", "/api/v1/settings/status-page", p, true), 204)
	body := get("/api/v1/status", 200)
	for _, secret := range []string{"internal billing", other, "NAT test", "public_ipv4", "interfaces", "agent_version", "tcp_probe_targets"} {
		if strings.Contains(body, secret) {
			t.Fatalf("private field %q was disclosed", secret)
		}
	}
	if !strings.Contains(body, "Amsterdam") {
		t.Fatal(body)
	}
	get("/api/v1/status/nodes/"+other+"/history", 404)
	historyPath := "/api/v1/status/nodes/" + id + "/history"
	checkExistingSample := func() {
		t.Helper()
		history := decodeResponse[StatusHistory](t, f.request("GET", historyPath, nil, false), 200)
		for _, point := range history.Charts["cpu"].Points {
			if value := point.Values["cpu"]; point.At.Equal(sampleAt) && value != nil && *value == cpu {
				return
			}
		}
		t.Fatal("missing CPU sample recorded before publication")
	}
	checkExistingSample()
	for _, r := range []string{"1h", "6h", "24h", "7d"} {
		get("/api/v1/status/nodes/"+id+"/history?range="+r, 200)
	}
	get("/api/v1/status/nodes/"+id+"/history?range=99d", 400)
	expectStatus(t, f.request("PUT", "/api/v1/settings/status-page", p, true), 409)
	// Changes to visibility bypass the shared metrics cache immediately.
	cat.Revision = 4
	cat.Items[1].Shared = false
	if err := f.store.SaveCategories(ctx, "user", cat); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(get("/api/v1/status", 200), "Amsterdam") {
		t.Fatal("withdrawn tag cached")
	}
	p.Revision = 2
	p.Enabled = false
	expectStatus(t, f.request("PUT", "/api/v1/settings/status-page", p, true), 204)
	get("/api/v1/status", 404)
	get("/api/v1/status/nodes/"+id+"/history", 404)
	p.Revision++
	p.Enabled = true
	expectStatus(t, f.request("PUT", "/api/v1/settings/status-page", p, true), 204)
	checkExistingSample()
}
func TestStatusRoles(t *testing.T) {
	for _, role := range []string{"viewer", "operator"} {
		f := setup(t, role)
		expectStatus(t, f.request("GET", "/api/v1/node-categories", nil, true), 200)
		for _, route := range []struct{ method, path string }{{"GET", "/api/v1/settings/status-page"}, {"PUT", "/api/v1/settings/status-page"}, {"POST", "/api/v1/settings/status-page/preview"}, {"PATCH", "/api/v1/node-categories/members"}, {"PUT", "/api/v1/node-categories"}} {
			expectStatus(t, f.request(route.method, route.path, nil, true), 403)
		}
	}
}
func TestPublicStatusStreamWithdrawsOnClose(t *testing.T) {
	f := setup(t, "admin")
	enableSettings(t, f)
	id, _ := f.enroll()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	config := inventory.StatusPublication{Enabled: true, Revision: 1, Nodes: []inventory.PublishedNode{{ID: id, Alias: "Public alias"}}}
	if err := f.store.SaveStatusPublication(ctx, "user", config); err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, f.server.URL+"/api/v1/status/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	res, err := f.server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	scan := bufio.NewScanner(res.Body)
	if !scan.Scan() || scan.Text() != "event: snapshot" || !scan.Scan() || !strings.Contains(scan.Text(), "Public alias") || !scan.Scan() || scan.Text() != "" {
		t.Fatalf("unexpected initial snapshot, HTTP %d: %v", res.StatusCode, scan.Err())
	}
	config.Enabled, config.Revision = false, 2
	if err = f.store.SaveStatusPublication(ctx, "user", config); err != nil {
		t.Fatal(err)
	}
	if !scan.Scan() || scan.Text() != "event: withdrawn" {
		t.Fatalf("missing withdrawal event: %v", scan.Err())
	}
}
func TestStatusLinesKeepAddressesPrivate(t *testing.T) {
	at := time.Now().Add(-time.Hour).UTC()
	batch := v1.TelemetryTCPProbeBatch{SampledAt: at, Targets: []*v1.TelemetryTCPProbe{{Target: "example.org:443", Ping: -1, Loss: 100}}}
	cfg := &v1.TelemetryTCPProbeSettings{Targets: []string{"example.org:443"}}
	lines := statusLines(cfg, monitoring.TCPHistory{Points: []monitoring.TCPHistoryPoint{{TelemetryTCPProbeBatch: batch}}}, nil)
	if len(lines) != 1 || lines[0].Name != "线路 1" || len(lines[0].History) != 1 || lines[0].Latest.Loss != 100 || lines[0].Latest.Ping != -1 || !lines[0].Latest.At.Equal(at) {
		t.Fatal(lines)
	}
}
