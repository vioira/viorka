package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Exercise the same persisted identity through live cutover, offline recovery,
// an unavailable new endpoint and a cold start after retiring the old address.
func TestExistingAgentOriginMigration(t *testing.T) {
	binary := os.Getenv("VIORKA_TEST_AGENT_BINARY")
	if binary == "" {
		t.Skip("set VIORKA_TEST_AGENT_BINARY to a locally built Agent CLI")
	}
	f := setup(t, "admin")
	enableSettings(t, f)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	var ready atomic.Bool
	var attempts atomic.Int32
	next := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !ready.Load() {
			attempts.Add(1)
			http.Error(w, "not ready", 503)
			return
		}
		f.server.Config.Handler.ServeHTTP(w, r)
	}))
	defer next.Close()
	type agent struct {
		cfg, id, identity string
		key               []byte
	}
	register := func(name string) agent {
		dir := t.TempDir()
		caFile := filepath.Join(dir, "ca.pem")
		check := func(err error) {
			t.Helper()
			if err != nil {
				t.Fatal(err)
			}
		}
		check(os.WriteFile(caFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: f.server.Certificate().Raw}), 0600))
		cfg := filepath.Join(dir, "config.json")
		raw, err := json.Marshal(map[string]any{"panel_url": f.server.URL, "state_dir": filepath.Join(dir, "state"), "node_name": name, "ca_file": caFile})
		check(err)
		check(os.WriteFile(cfg, raw, 0600))
		enrollment, err := f.agents.CreateEnrollment(ctx, "user", name, "nat")
		check(err)
		cmd := exec.CommandContext(ctx, binary, "register", "--config", cfg, "--token-stdin")
		cmd.Stdin = strings.NewReader(enrollment.Token + "\n")
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("register failed: %v %s", err, out)
		}
		identity := filepath.Join(dir, "state", "identity.json")
		raw, err = os.ReadFile(identity)
		check(err)
		var saved struct {
			Key []byte `json:"private_key"`
		}
		check(json.Unmarshal(raw, &saved))
		return agent{cfg, enrollment.ID, identity, saved.Key}
	}
	start := func(a agent) func() {
		cmd := exec.CommandContext(ctx, binary, "run", "--config", a.cfg)
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		stopped := false
		stop := func() {
			if !stopped {
				stopped = true
				_ = cmd.Process.Signal(os.Interrupt)
				_ = cmd.Wait()
			}
		}
		t.Cleanup(stop)
		return stop
	}
	wait := func(what string, check func() bool) {
		t.Helper()
		deadline := time.Now().Add(20 * time.Second)
		for !check() {
			if time.Now().After(deadline) {
				t.Fatalf("timeout waiting for %s", what)
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
	stateIs := func(a agent, state, migration string) bool {
		n, err := f.store.Node(ctx, a.id)
		if err != nil {
			t.Fatal(err)
		}
		return n.State == state && n.OriginMigration == migration
	}
	online := register("online")
	offline := register("offline")
	stopOnline := start(online)
	wait("first online", func() bool { return stateIs(online, "online", "") })
	// An old binary can be distinguished from an offline, never-negotiated one.
	legacy, key := f.enroll()
	socket := f.socket(legacy, f.token(legacy, key))
	defer socket.CloseNow()
	current := decodeResponse[SettingsResponse](t, f.request("GET", "/api/v1/settings", nil, true), 200)
	current.Settings.PublicOrigin = next.URL
	decodeResponse[SettingsResponse](t, f.request("PUT", "/api/v1/settings", current.Settings, true), 200)
	wait("attempt on unavailable candidate", func() bool { return attempts.Load() > 0 })
	if !stateIs(offline, "offline", "pending") {
		t.Fatal("offline node missing migration intent")
	}
	n, err := f.store.Node(ctx, legacy)
	if err != nil || n.OriginMigration != "upgrade_required" {
		t.Fatal("legacy node should require upgrade", err)
	}
	n, err = f.store.Node(ctx, online.id)
	if err != nil || n.OriginMigration != "pending" {
		t.Fatal("failed trial was marked complete", err)
	}
	ready.Store(true)
	stopOffline := start(offline)
	for _, a := range []agent{online, offline} {
		wait("confirmation", func() bool { return stateIs(a, "online", "confirmed") })
		raw, err := os.ReadFile(a.identity)
		if err != nil {
			t.Fatal(err)
		}
		var id struct {
			Node   string `json:"node_id"`
			Key    []byte `json:"private_key"`
			Origin string `json:"active_origin"`
		}
		if json.Unmarshal(raw, &id) != nil || id.Origin != next.URL || id.Node != a.id || !bytes.Equal(id.Key, a.key) {
			t.Fatal("migration did not preserve identity and commit verified target")
		}
	}
	stopOnline()
	stopOffline()
	socket.CloseNow()
	f.server.Close()
	wait("graceful shutdown", func() bool { return stateIs(offline, "offline", "confirmed") })
	start(offline)
	wait("restart using only new origin", func() bool { return stateIs(offline, "online", "confirmed") })
}
