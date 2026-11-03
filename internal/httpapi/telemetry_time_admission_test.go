package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

// Wall-clock TLS tests use margins; exact nanosecond boundaries are checked by
// protocol.TestTelemetryContextAdmission with a deterministic received_at.
func TestTelemetryHTTPTimestampAdmissionAndAtomicity(t *testing.T) {
	for _, tc := range []struct {
		name                 string
		fastOffset, ipOffset time.Duration
		badSecond            bool
		status               int
		accepted             uint64
	}{
		{"R180 accepts eight-minute sample", -480 * time.Second, 0, false, 200, 1},
		{"reject beyond R180 window", -510 * time.Second, 0, false, 400, 0},
		{"accept within future allowance", 290 * time.Second, 0, false, 200, 1},
		{"reject beyond future allowance", 310 * time.Second, 0, false, 400, 0},
		{"bad second fast rejects whole batch", 0, 0, true, 400, 0},
		{"cached IP retains independent window", 0, -900 * time.Second, false, 200, 2},
		{"expired IP rejects otherwise valid fast", 0, -930 * time.Second, false, 400, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := setup(t, "admin")
			node, key := f.enroll()
			token := f.token(node, key)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			now := time.Now().UTC()
			recorder, err := monitoring.NewTelemetryRecorder(ctx, f.store, now)
			if err != nil {
				t.Fatal(err)
			}
			ingress := monitoring.NewTelemetryIngress(recorder)
			settings := v1.DefaultTelemetrySettings()
			settings.HttpReportSeconds = 180
			if err = ingress.Activate(node, auth.Hash(token), "generation", now.Add(time.Hour), settings, now); err != nil {
				t.Fatal(err)
			}
			server := httptest.NewTLSServer(NewRouter(Dependencies{Agents: f.agents, Telemetry: ingress}))
			defer server.Close()
			fixture, err := os.ReadFile("../../api/agent/v1/examples/node.metrics.v3.json")
			if err != nil {
				t.Fatal(err)
			}
			var envelope v1.Envelope
			if err = json.Unmarshal(fixture, &envelope); err != nil {
				t.Fatal(err)
			}
			var batch v1.TelemetryBatch
			if err = json.Unmarshal(envelope.Payload, &batch); err != nil {
				t.Fatal(err)
			}
			batch.NodeID = node
			batch.Fast[0].SampledAt = now.Add(tc.fastOffset)
			batch.Full = []*v1.TelemetryFull{}
			batch.PublicIp = []*v1.TelemetryPublicIP{}
			if tc.badSecond {
				bad := *batch.Fast[0]
				bad.Sequence = 2
				bad.SampledAt = now.Add(310 * time.Second)
				batch.Fast = append(batch.Fast, &bad)
			}

			if tc.ipOffset != 0 {
				batch.PublicIp = append(batch.PublicIp, &v1.TelemetryPublicIP{Sequence: 1, SampledAt: now.Add(tc.ipOffset), Ipv4: "8.8.8.8", Errors: []string{"ipv6_unavailable"}})
			}
			raw, err := json.Marshal(batch)
			if err != nil {
				t.Fatal(err)
			}
			request, err := http.NewRequestWithContext(ctx, "POST", server.URL+"/api/v1/agents/metrics", strings.NewReader(string(raw)))
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Authorization", "Bearer "+token)
			request.Header.Set("Content-Type", "application/json")
			response, err := server.Client().Do(request)
			if err != nil {
				t.Fatal(err)
			}
			body, err := io.ReadAll(response.Body)
			response.Body.Close()
			if err != nil {
				t.Fatal(err)
			}
			if response.StatusCode != tc.status {
				t.Fatalf("status=%d want=%d body=%s", response.StatusCode, tc.status, body)
			}
			if tc.status == 200 {
				var receipt v1.TelemetryReceipt
				if json.Unmarshal(body, &receipt) != nil || receipt.AcceptedCount != tc.accepted {
					t.Fatal("acceptance count", string(body))
				}
			}
			if err = recorder.Flush(ctx, now, true); err != nil {
				t.Fatal(err)
			}
			history, err := f.store.TelemetryHistory(ctx, node, now.Add(-10*time.Minute), now.Add(6*time.Minute), now.Add(6*time.Minute), 30)
			if err != nil {
				t.Fatal(err)
			}
			var count uint64
			for _, bucket := range history {
				count += bucket.FastCount
			}
			want := uint64(0)
			if tc.status == 200 {
				want = 1
			}
			if count != want {
				t.Fatalf("partial acceptance or sample loss: persisted=%d want=%d", count, want)
			}
			live, err := ingress.Live(node, now, monitoring.Cursor{}, false, false)
			if err != nil {
				t.Fatal(err)
			}
			if tc.status != 200 && live.RunID != "" {
				t.Fatal("rejected batch mutated live run")
			}
			if tc.status == 200 && tc.ipOffset != 0 && (live.PublicIP == nil || !live.PublicIP.SampledAt.Equal(now.Add(tc.ipOffset))) {
				t.Fatal("cached IP timestamp refreshed")
			}
		})
	}
}
