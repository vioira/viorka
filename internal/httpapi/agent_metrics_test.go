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

func TestAgentMetricsTLSAdmission(t *testing.T) {
	f := setup(t, "admin")
	node, key := f.enroll()
	token := f.token(node, key)
	ctx := context.Background()
	now := time.Now().UTC()
	recorder, err := monitoring.NewTelemetryRecorder(ctx, f.store, now)
	if err != nil {
		t.Fatal(err)
	}
	ingress := monitoring.NewTelemetryIngress(recorder)
	server := httptest.NewTLSServer(NewRouter(Dependencies{Agents: f.agents, Telemetry: ingress}))
	defer server.Close()
	raw, err := os.ReadFile("../../api/agent/v1/examples/node.metrics.v3.json")
	if err != nil {
		t.Fatal(err)
	}
	var e struct {
		Payload v1.TelemetryBatch `json:"payload"`
	}
	if err = json.Unmarshal(raw, &e); err != nil {
		t.Fatal(err)
	}
	b := e.Payload
	b.NodeID = node
	b.Fast[0].SampledAt = now
	b.Full[0].SampledAt = now
	raw, err = json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	request := func(body, query string, headers http.Header) (int, http.Header, string) {
		t.Helper()
		req, err := http.NewRequest("POST", server.URL+"/api/v1/agents/metrics"+query, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header = headers
		res, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		data, err := io.ReadAll(res.Body)
		if err != nil {
			t.Fatal(err)
		}
		return res.StatusCode, res.Header, string(data)
	}
	headers := http.Header{"Authorization": []string{"Bearer " + token}, "Content-Type": []string{"application/json"}}
	status, _, data := request(string(raw), "", headers)
	if status != 409 || !strings.Contains(data, "stale_session") {
		t.Fatal(status, data)
	}
	if err = ingress.Activate(node, auth.Hash(token), "generation", now.Add(time.Hour), v1.DefaultTelemetrySettings(), now); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		status, _, data = request(string(raw), "", headers)
		var receipt v1.TelemetryReceipt
		if status != 200 || json.Unmarshal([]byte(data), &receipt) != nil || receipt.Validate(2) != nil || receipt.AcceptedCount != uint64(2-2*i) {
			t.Fatal(status, data)
		}
	}
	// No management connection was established. Upload does not mark the node online.
	if err = recorder.Flush(ctx, now, true); err != nil {
		t.Fatal(err)
	}
	history, err := f.store.MetricHistory(ctx, node, now.Add(-time.Minute), now.Add(time.Minute), 30)
	if err != nil || len(history.Points) != 1 || history.Points[0].CPU.Count != 1 {
		t.Fatal("duplicate persisted", history, err)
	}
	observed, err := f.store.Node(ctx, node)
	if err != nil || observed.State == "online" {
		t.Fatal("POST changed management state", observed.State, err)
	}
	for _, tc := range []struct {
		name, body, query string
		headers           http.Header
		status            int
	}{
		{"cookie identity", string(raw), "", http.Header{"Cookie": []string{"viorka_session=example"}}, 403},
		{"missing auth", string(raw), "", http.Header{}, 401},
		{"URL credentials", string(raw), "?token=hidden", headers, 403},
		{"origin", string(raw), "", http.Header{"Authorization": headers["Authorization"], "Origin": []string{"https://browser.test"}}, 403},
		{"wrong media", string(raw), "", http.Header{"Authorization": headers["Authorization"], "Content-Type": []string{"text/plain"}}, 415},
		{"oversized", strings.Repeat(" ", v1.TelemetryMaxBodyBytes+1), "", headers, 413},
		{"unknown fields", `{"extra":true}`, "", headers, 400},
		{"cross node", strings.Replace(string(raw), node, "other-node", 1), "", headers, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, _, data := request(tc.body, tc.query, tc.headers)
			if status != tc.status {
				t.Fatal(status, data)
			}
		})
	}
	for i := 0; i < 40; i++ {
		status, h, data := request("{}", "", headers)
		if status == 429 {
			if h.Get("Retry-After") != "1" || !strings.Contains(data, "rate_limited") {
				t.Fatal(h, data)
			}
			break
		}
		if i == 39 {
			t.Fatal("rate budget not enforced")
		}
	}
	// A known expired session returns refreshable classification even when no
	// capability binding exists for that replacement token.
	challenge, err := f.agents.Challenge(ctx, node)
	if err != nil {
		t.Fatal(err)
	}
	expiredToken := auth.Random()
	if _, err = f.store.ConsumeChallenge(ctx, challenge.ID, func(string, string) bool { return true }, auth.Hash(expiredToken), now.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	expiredHeaders := headers.Clone()
	expiredHeaders.Set("Authorization", "Bearer "+expiredToken)
	status, _, data = request(string(raw), "", expiredHeaders)
	if status != 401 || !strings.Contains(data, "session_expired") {
		t.Fatal(status, data)
	}
	// Refresh uses the existing signed challenge helper, never the telemetry POST.
	token = f.token(node, key)
	headers.Set("Authorization", "Bearer "+token)
	if err = f.agents.Revoke(ctx, f.session.User.ID, node); err != nil {
		t.Fatal(err)
	}
	status, _, data = request(string(raw), "", headers)
	if status != 401 || !strings.Contains(data, "session_invalid") {
		t.Fatal("revoked token", status, data)
	}
}
