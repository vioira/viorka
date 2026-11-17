package httpapi

import (
	"context"
	"encoding/json"
	"encoding/pem"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
)

// Uses the actual separately built Agent CLI over verified TLS and WSS.
func TestRegistrationAgentProcess(t *testing.T) {
	binary := os.Getenv("VIORKA_TEST_AGENT_BINARY")
	if binary == "" {
		t.Skip("set VIORKA_TEST_AGENT_BINARY to a locally built Agent CLI")
	}
	if !filepath.IsAbs(binary) {
		t.Fatal("Agent binary must be absolute")
	}
	f := setup(t, "admin")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	token, err := f.agents.CreateRegistrationToken(ctx, "user", auth.RegistrationOptions{Name: "process", Kind: "nat", MaxUses: 2, ExpiresInHours: 1})
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"batch-one", "batch-two", "single"} {
		secret, id := token.Token, ""
		if name == "single" {
			enrollment, err := f.agents.CreateEnrollment(ctx, "user", name, "nat")
			if err != nil {
				t.Fatal(err)
			}
			secret, id = enrollment.Token, enrollment.ID
		}
		dir := t.TempDir()
		ca := filepath.Join(dir, "ca.pem")
		cfg := filepath.Join(dir, "agent.json")
		if err = os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: f.server.Certificate().Raw}), 0600); err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(map[string]any{"panel_url": f.server.URL, "node_name": name, "state_dir": filepath.Join(dir, "state"), "ca_file": ca})
		if err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(cfg, raw, 0600); err != nil {
			t.Fatal(err)
		}
		register := exec.CommandContext(ctx, binary, "register", "--config", cfg, "--token-stdin", "--name", name)
		register.Stdin = strings.NewReader(secret + "\n")
		if output, err := register.CombinedOutput(); err != nil {
			t.Fatalf("register failed: %v: %s", err, output)
		}
		records, err := f.agents.RegistrationRecords(ctx, token.ID, 10, "")
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range records {
			if r.Name == name {
				id = r.NodeID
			}
		}
		if id == "" {
			t.Fatal("node missing")
		}
		command := exec.CommandContext(ctx, binary, "run", "--config", cfg)
		command.WaitDelay = 3 * time.Second
		if err = command.Start(); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() { done <- command.Wait() }()
		online := false
		deadline := time.NewTimer(15 * time.Second)
		ticker := time.NewTicker(50 * time.Millisecond)
	loop:
		for {
			select {
			case err := <-done:
				deadline.Stop()
				ticker.Stop()
				t.Fatalf("Agent exited: %v", err)
			case <-deadline.C:
				break loop
			case <-ticker.C:
				n, err := f.store.Node(ctx, id)
				if err != nil {
					t.Error(err)
					break loop
				}
				if n.State == "online" {
					online = true
					break loop
				}
			}
		}
		deadline.Stop()
		ticker.Stop()
		command.Process.Kill()
		<-done
		if !online {
			t.Fatal("registered Agent did not establish WSS")
		}
	}
	tokens, err := f.agents.RegistrationTokens(ctx, 10, "")
	if err != nil || len(tokens) != 1 || tokens[0].UsedCount != 2 {
		t.Fatal(tokens, err)
	}
}
