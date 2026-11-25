package httpapi

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"slices"
	"strings"
	"testing"
	"testing/synctest"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/settings"
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
		for _, chartKey := range []string{"cpu", "memory", "network", "connections", "load", "disk", "disk_io", "processes"} {
			if _, ok := history.Charts[chartKey]; !ok {
				t.Fatalf("missing public chart %q", chartKey)
			}
		}
		for _, point := range history.Charts["cpu"].Points {
			if value := point.Values["cpu"]; point.At.Equal(sampleAt) && value != nil && *value == cpu {
				return
			}
		}
		t.Fatal("missing CPU sample recorded before publication")
	}
	checkExistingSample()
	for _, r := range []string{"1h", "6h", "24h", "2d", "7d"} {
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

func TestStatusNodeIncludesPublicSpecsAndRedactsSecrets(t *testing.T) {
	f := setupConfigured(t, "admin", true)
	id, key := f.enroll()
	token := f.token(id, key)
	ws := f.socket(id, token, v1.TelemetryCapability, v1.DailyTrafficCapability, "node.cpu_cores.v1")
	ready := receive(t, ws)
	var settings v1.TelemetryReady
	if ready.Type != "node.telemetry.ready" || v1.DecodeTelemetry(ready.Payload, &settings, false) != nil || settings.Settings == nil {
		t.Fatalf("unexpected telemetry ready frame: %+v", ready)
	}
	ctx := t.Context()
	raw, err := os.ReadFile("../../api/agent/v1/examples/node.metrics.v3.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Payload v1.TelemetryBatch `json:"payload"`
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	dayStart := now.Truncate(24 * time.Hour)
	batch := fixture.Payload
	batch.NodeID = id
	batch.Fast[0].SampledAt = now
	swapTotal, swapUsed := uint64(2000), uint64(128)
	tcpInuse, udpInuse, procs := uint64(64), uint64(12), uint64(118)
	batch.Fast[0].SwapTotal = &swapTotal
	batch.Fast[0].SwapUsed = &swapUsed
	batch.Fast[0].TcpInuse = &tcpInuse
	batch.Fast[0].UdpInuse = &udpInuse
	batch.Fast[0].Errors = slices.DeleteFunc(batch.Fast[0].Errors, func(code string) bool { return code == "sockets_unavailable" })
	batch.Fast[0].Interfaces[0].Name = "eth0-secret"
	rxRate := 1250.0
	batch.Fast[0].Interfaces[0].RXBytesPerSecond = &rxRate
	batch.Fast[0].Interfaces[0].Quality = []string{"partial"}
	batch.Full[0].SampledAt = now
	batch.Full[0].ElapsedSeconds = 60
	batch.Full[0].Processes = &procs
	batch.Full[0].Errors = slices.DeleteFunc(batch.Full[0].Errors, func(code string) bool { return code == "disk_io_unavailable" || code == "processes_unavailable" })
	diskRead, diskWrite, ops, util := 1024.0, 2048.0, 12.0, 18.5
	batch.Full[0].DiskIo = &v1.TelemetryDiskIO{
		ReadBytesPerSecond: &diskRead, WriteBytesPerSecond: &diskWrite,
		ReadIops: &ops, WriteIops: &ops, UtilPercent: &util, Quality: []string{},
	}
	batch.PublicIp = []*v1.TelemetryPublicIP{{Sequence: 1, SampledAt: now, Ipv4: "8.8.8.8", Errors: []string{"ipv6_unavailable"}}}
	batch.DailyTraffic = []*v1.TelemetryDailyTraffic{{
		DayStart: dayStart, DayEnd: dayStart.Add(24 * time.Hour),
		RXBytes: "12345", TXBytes: "67890", SampledAt: now, Revision: 1,
	}}
	applied := v1.Message("node.settings.v3_result", id, auth.Random(), v1.TelemetrySettingsResult{
		Revision: settings.Settings.Revision, AppliedRevision: settings.Settings.Revision, State: "applied",
	})
	applied.CorrelationID = ready.MessageID
	cores := uint64(4)
	send(tWriter{t, ws}, v1.Message("node.heartbeat", id, auth.Random(), v1.Heartbeat{CPUCores: &cores}))
	send(tWriter{t, ws}, applied)
	// Same-socket ordering: wait for receipt before posting via HTTP.
	send(tWriter{t, ws}, v1.Message("node.metrics.v3", id, auth.Random(), batch))
	if resp := receive(t, ws); resp.Type != "node.metrics.receipt" {
		t.Fatalf("expected receipt, got %+v", resp)
	}
	encoded, err := json.Marshal(batch)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest("POST", f.server.URL+"/api/v1/agents/metrics", strings.NewReader(string(encoded)))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	postRes, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	postBody := read(postRes)
	if postRes.StatusCode != 200 {
		t.Fatalf("agent metrics POST failed: %d %s", postRes.StatusCode, postBody)
	}
	if err := f.store.SaveInventory(ctx, id, v1.NodeInventory{
		SampledAt: now, OSID: "debian", OSName: "Debian 12", OSVersion: "12",
		PublicIpv4: "8.8.8.8", Errors: []string{"public_ipv6_unavailable"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := f.store.SaveLocation(ctx, id, "8.8.8.8", inventory.Location{CountryCode: "JP", Subdivision: "Tokyo", City: "Chiyoda"}); err != nil {
		t.Fatal(err)
	}
	p := inventory.StatusPublication{Revision: 1, Enabled: true, Nodes: []inventory.PublishedNode{{ID: id, Alias: "Tokyo Node"}}}
	expectStatus(t, f.request("PUT", "/api/v1/settings/status-page", p, true), 204)

	res := f.request("GET", "/api/v1/status", nil, false)
	body := read(res)
	if res.StatusCode != 200 {
		t.Fatalf("status 200 expected, got %d: %s", res.StatusCode, body)
	}
	for _, secret := range []string{"8.8.8.8", "eth0-secret", "NAT test", "agent_version"} {
		if strings.Contains(body, secret) {
			t.Fatalf("secret %q leaked in public status: %s", secret, body)
		}
	}
	page := decodeResponse[StatusPage](t, f.request("GET", "/api/v1/status", nil, false), 200)
	if len(page.Nodes) != 1 {
		t.Fatalf("expected 1 node, got %d", len(page.Nodes))
	}
	node := page.Nodes[0]
	if node.CPUCores == nil || *node.CPUCores != 4 || node.Kind != "nat" || node.Arch != "amd64" || node.Subdivision != "Tokyo" || node.City != "Chiyoda" || !node.IPv4 {
		t.Fatalf("missing public node specs: %+v", node)
	}
	if node.Fast == nil || node.Fast.SwapUsed == nil || *node.Fast.SwapUsed != "128" || node.Fast.TCPInuse == nil || *node.Fast.TCPInuse != "64" {
		t.Fatalf("missing public fast fields: %+v", node.Fast)
	}
	if node.Full == nil || node.Full.Processes == nil || *node.Full.Processes != "118" || node.Full.DiskIO == nil || *node.Full.DiskIO.ReadBytesPerSecond != 1024 {
		t.Fatalf("missing public full fields: %+v", node.Full)
	}
	if node.Fast.RX == nil || *node.Fast.RX != rxRate || node.Fast.TX != nil {
		t.Fatalf("expected only RX bandwidth: %+v", node.Fast)
	}
	wantExpiry := now.Add(time.Duration(max(uint64(90), 3*settings.Settings.HttpReportSeconds)) * time.Second)
	if !node.Full.ExpiresAt.Equal(wantExpiry) {
		t.Fatalf("full expiry = %s, want %s", node.Full.ExpiresAt, wantExpiry)
	}
	if node.Daily == nil || node.Daily.RXBytes != "12345" || node.Daily.TXBytes != "67890" {
		t.Fatalf("missing public daily traffic: %+v", node.Daily)
	}
}

func TestPublicVisitorsShareDemandAndReceiveWSSDelta(t *testing.T) {
	f := setupConfigured(t, "admin", true)
	enableSettings(t, f)
	id, key := f.enroll()
	private, _ := f.enroll()
	conn := f.socket(id, f.token(id, key), v1.TelemetryCapability)
	ready := receive(t, conn)
	var cfg v1.TelemetryReady
	if err := v1.DecodeTelemetry(ready.Payload, &cfg, false); err != nil || cfg.Settings == nil {
		t.Fatal("telemetry ready", err)
	}
	result := v1.Message("node.settings.v3_result", id, auth.Random(), v1.TelemetrySettingsResult{Revision: cfg.Settings.Revision, AppliedRevision: cfg.Settings.Revision, State: "applied"})
	result.CorrelationID = ready.MessageID
	send(tWriter{t, conn}, result)

	publication := inventory.StatusPublication{Revision: 1, Enabled: true, Nodes: []inventory.PublishedNode{{ID: id, Alias: "published"}}}
	if err := f.store.SaveStatusPublication(t.Context(), "user", publication); err != nil {
		t.Fatal(err)
	}
	sampleAt := time.Now().UTC().Add(-2 * time.Minute).Truncate(30 * time.Second)
	cpu := 37.5
	bucket := monitoring.NewBucket(id, sampleAt)
	if err := bucket.AddFast(&v1.TelemetryFast{SampledAt: sampleAt, CPUPercent: &cpu}); err != nil {
		t.Fatal(err)
	}
	if err := f.store.SaveTelemetryHistory(t.Context(), []monitoring.NodeHistory{{Node: id, Buckets: []monitoring.Bucket{bucket}}}, time.Now()); err != nil {
		t.Fatal(err)
	}
	open := func(scope string) (*http.Response, *bufio.Reader) {
		t.Helper()
		res := f.request("GET", "/api/v1/status/events?node="+scope, nil, false)
		t.Cleanup(func() { res.Body.Close() })
		r := bufio.NewReader(res.Body)
		if kind, data := nextSSE(t, r); kind != "snapshot" || !strings.Contains(data, "published") {
			t.Fatalf("initial frame %s %s", kind, data)
		}
		return res, r
	}
	one, privateReader := open(private)
	two, r := open(id)
	kind, data := nextSSE(t, r)
	var initial statusTrendEvent
	if kind != "metric_trends" || json.Unmarshal([]byte(data), &initial) != nil || initial.NodeID != id || len(initial.Charts) != 8 || !initial.Charts["cpu"].Reset {
		t.Fatalf("unexpected detail seed %s %s", kind, data)
	}
	if !slices.ContainsFunc(initial.Charts["cpu"].Points, func(p monitoring.MetricTrendPoint) bool {
		return p.Source == "history" && p.At.Equal(sampleAt) && p.Values["cpu"] != nil && *p.Values["cpu"] == cpu
	}) {
		t.Fatal("missing retained CPU bucket", initial.Charts["cpu"])
	}
	if f.gate.TelemetryDemand(id).References != 1 || f.gate.TelemetryDemand(private).References != 0 {
		t.Fatal("public scope must be shared and restricted to published nodes")
	}
	if err := ackTelemetryLoadDemand(t.Context(), conn, id, cfg.SessionGeneration, receive(t, conn)); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile("../../api/agent/v1/examples/node.metrics.v3.json")
	if err != nil {
		t.Fatal(err)
	}
	var sample struct{ Payload v1.TelemetryBatch }
	if err = json.Unmarshal(raw, &sample); err != nil {
		t.Fatal(err)
	}
	sample.Payload.NodeID = id
	sample.Payload.Fast[0].SampledAt = time.Now().UTC().Add(-time.Second)
	sample.Payload.Full = []*v1.TelemetryFull{}
	sample.Payload.Fast[0].Interfaces[0].Name = "private-interface"
	second := *sample.Payload.Fast[0]
	second.Sequence++
	second.SampledAt = second.SampledAt.Add(time.Second)
	sample.Payload.Fast = append(sample.Payload.Fast, &second)
	send(tWriter{t, conn}, v1.Message("node.metrics.v3", id, auth.Random(), sample.Payload))
	reply := receive(t, conn)
	var receipt v1.TelemetryReceipt
	if reply.Type != "node.metrics.receipt" || json.Unmarshal(reply.Payload, &receipt) != nil || receipt.State == "rejected" {
		t.Fatalf("WSS receipt %+v", reply)
	}
	// Summary and trend frames may arrive in either order on the same stream.
	var live statusTrendEvent
	for range 2 {
		event, payload := nextSSE(t, r)
		if strings.Contains(payload, "private-interface") || strings.Contains(payload, private) {
			t.Fatal("non-public data in detail stream")
		}
		if event == "metric_trends" {
			if err := json.Unmarshal([]byte(payload), &live); err != nil {
				t.Fatal(err)
			}
		} else {
			kind, data = event, payload
		}
	}
	var rawTimes []time.Time
	for _, p := range live.Charts["cpu"].Points {
		if p.Source == "live" && p.Values["cpu"] != nil {
			rawTimes = append(rawTimes, p.At)
		}
	}
	if len(rawTimes) != 2 || !rawTimes[0].Equal(sample.Payload.Fast[0].SampledAt) || !rawTimes[1].Equal(second.SampledAt) {
		t.Fatalf("missing per-sample trend updates: %+v", live.Charts["cpu"])
	}
	if kind, _ := nextSSE(t, privateReader); kind != "delta" {
		t.Fatalf("unpublished scope received %q", kind)
	}
	one.Body.Close()
	var delta statusDelta
	if kind != "delta" || json.Unmarshal([]byte(data), &delta) != nil || len(delta.Nodes) != 1 || !strings.Contains(string(delta.Nodes[id]["fast"]), "12.5") || strings.Contains(data, "private-interface") || strings.Contains(data, "published") {
		t.Fatalf("unexpected public patch: %s %s", kind, data)
	}
	two.Body.Close()
	deadline := time.Now().Add(2 * time.Second)
	for f.gate.TelemetryDemand(id).References > 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	scope := f.gate.TelemetryDemand(id)
	if scope.References != 0 || !scope.GraceUntil.After(time.Now()) {
		t.Fatalf("public demand not released: %+v", scope)
	}
}

func TestPublicStatusFixedWindows(t *testing.T) {
	f := setup(t, "admin")
	enableSettings(t, f)
	aID, _ := f.enroll()
	bID, _ := f.enroll()
	cID, _ := f.enroll()
	pub := inventory.StatusPublication{Revision: 1, Enabled: true, Nodes: []inventory.PublishedNode{{ID: aID, Alias: "A"}, {ID: bID, Alias: "B"}, {ID: cID, Alias: "C"}}}
	if err := f.store.SaveStatusPublication(t.Context(), "user", pub); err != nil {
		t.Fatal(err)
	}

	synctest.Test(t, func(t *testing.T) {
		a := &api{Dependencies: Dependencies{Nodes: f.store, Settings: settings.New(f.store), Events: f.store.Events(), Shutdown: t.Context()}}
		ch, leave := a.joinStatus(f.store)
		defer leave()
		if frame := <-ch; frame.event != "snapshot" {
			t.Fatal("first frame", frame.event)
		}
		start := time.Now().Truncate(2 * time.Second)
		at := func(offset time.Duration) { time.Sleep(time.Until(start.Add(offset))) }
		update := func(id string, seconds float64) {
			t.Helper()
			changed, err := f.store.SaveNodeUptime(t.Context(), id, seconds, time.Now(), false)
			if !changed || err != nil {
				t.Fatal("uptime update", changed, err)
			}
			synctest.Wait()
		}
		quiet := func() {
			t.Helper()
			synctest.Wait()
			select {
			case frame := <-ch:
				t.Fatalf("unexpected %s at %v", frame.event, time.Now())
			default:
			}
		}
		check := func(offset time.Duration, want map[string]string) {
			t.Helper()
			synctest.Wait()
			select {
			case frame := <-ch:
				d, ok := frame.value.(statusDelta)
				if frame.event != "delta" || !ok || !d.At.Equal(start.Add(offset)) || len(d.Nodes) != len(want) {
					t.Fatalf("unexpected delta %+v", frame)
				}
				for id, seconds := range want {
					if string(d.Nodes[id]["uptime"]) != seconds {
						t.Fatalf("wrong update for %s: %s", id, d.Nodes[id]["uptime"])
					}
				}
			default:
				t.Fatal("no event at window close")
			}
		}
		at(200 * time.Millisecond)
		update(aID, 10)
		at(600 * time.Millisecond)
		update(bID, 20)
		at(1500 * time.Millisecond)
		update(aID, 11)
		at(1999 * time.Millisecond)
		quiet()
		at(2 * time.Second)
		check(2*time.Second, map[string]string{aID: "11", bID: "20"})
		// An update exactly on the edge belongs to the next window.
		update(cID, 30)
		quiet()
		at(4 * time.Second)
		check(4*time.Second, map[string]string{cID: "30"})
		at(6 * time.Second)
		quiet()
		at(6200 * time.Millisecond)
		update(aID, 12)
		pub.Revision++
		pub.Nodes = pub.Nodes[1:]
		if err := f.store.SaveStatusPublication(t.Context(), "user", pub); err != nil {
			t.Fatal(err)
		}
		synctest.Wait()
		frame := <-ch
		page, ok := frame.value.(StatusPage)
		if frame.event != "snapshot" || !ok || len(page.Nodes) != 2 || page.Nodes[0].ID != bID || page.Nodes[1].ID != cID || time.Now().Sub(start) != 6200*time.Millisecond {
			t.Fatalf("withdrawal delayed or incorrect: %s", frame.event)
		}
		at(8 * time.Second)
		quiet()
	})
}

func TestPublicStatusSlowViewerResynchronizes(t *testing.T) {
	frames := make(chan statusFrame, 2)
	b := &statusBroadcast{viewers: map[chan statusFrame]struct{}{frames: {}}}
	a := &api{}
	for i := 1; i <= 3; i++ {
		a.publishStatus(b, statusFrame{event: "snapshot", value: i}, statusFrame{event: "delta", value: i})
	}
	if got := <-frames; got.event != "snapshot" || got.value != 3 || len(frames) != 0 {
		t.Fatal("missing replacement baseline", got)
	}
	a.publishStatus(b, statusFrame{event: "snapshot", value: 4}, statusFrame{event: "delta", value: 4})
	if got := <-frames; got.event != "delta" || got.value != 4 {
		t.Fatal("delta after baseline", got)
	}
}
