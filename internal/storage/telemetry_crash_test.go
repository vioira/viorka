package storage

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/monitoring"
)

func TestTelemetryRecorderCrashBoundary(t *testing.T) {
	for _, phase := range []string{"accepted", "committed"} {
		t.Run(phase, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			path := filepath.Join(t.TempDir(), "crash.db")
			at := time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)
			s, err := Open(ctx, path)
			if err != nil {
				t.Fatal(err)
			}
			metricNode(t, s, "n")
			r, err := monitoring.NewTelemetryRecorder(ctx, s, at)
			if err != nil {
				t.Fatal(err)
			}
			if err = r.BindRun("n", telemetryTestRun, at); err != nil {
				t.Fatal(err)
			}
			if _, err = r.Accept(telemetryBatchFixture(at, 1), at, 60); err != nil {
				t.Fatal(err)
			}
			if err = r.Flush(ctx, at, true); err != nil {
				t.Fatal(err)
			}
			if err = s.Close(); err != nil {
				t.Fatal(err)
			}
			child := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestTelemetryRecorderCrashChild$", "-test.count=1")
			child.Env = append(os.Environ(), "VIORKA_CRASH_TEST_PHASE="+phase, "VIORKA_CRASH_TEST_DB="+path)
			input, err := child.StdinPipe()
			if err != nil {
				t.Fatal(err)
			}
			defer input.Close()
			output, err := child.StdoutPipe()
			if err != nil {
				t.Fatal(err)
			}
			var stderr bytes.Buffer
			child.Stderr = &stderr
			if err = child.Start(); err != nil {
				t.Fatal(err)
			}
			waited := false
			defer func() {
				if !waited {
					child.Process.Kill()
					child.Wait()
				}
			}()
			ready := make(chan string, 1)
			go func() {
				scanner := bufio.NewScanner(output)
				if scanner.Scan() {
					ready <- scanner.Text()
				} else {
					ready <- ""
				}
			}()
			select {
			case message := <-ready:
				if message != "ready "+phase {
					t.Fatalf("child not ready: %q", message)
				}
			case <-ctx.Done():
				t.Fatal("child boundary timeout")
			}
			// SIGKILL on supported Unix targets: neither Store.Close nor a deferred
			// flush can run after the parent has observed this boundary.
			if err = child.Process.Kill(); err != nil {
				t.Fatal(err)
			}
			err = child.Wait()
			waited = true
			if err == nil {
				t.Fatal("child exited cleanly instead of being killed")
			}
			if ctx.Err() != nil {
				t.Fatal(ctx.Err())
			}
			reopened, err := Open(ctx, path)
			if err != nil {
				t.Fatal(err)
			}
			defer reopened.Close()
			history, err := reopened.TelemetryHistory(ctx, "n", at, at.Add(time.Minute), at.Add(time.Minute), 30)
			if err != nil {
				t.Fatal(err)
			}
			want := uint64(1)
			if phase == "committed" {
				want = 2
			}
			if len(history) != 1 || history[0].FastCount != want || history[0].CPU.Count != want || history[0].CPU.Sum == nil || *history[0].CPU.Sum != float64(want)*20 {
				t.Fatalf("crash boundary lost committed data or preserved uncommitted data: %+v", history)
			}
			restored, err := monitoring.NewTelemetryRecorder(ctx, reopened, at.Add(time.Minute))
			if err != nil {
				t.Fatal(err)
			}
			if err = restored.BindRun("n", telemetryTestRun, at.Add(time.Minute)); err != nil {
				t.Fatal(err)
			}
			sampleAt := at
			if want == 2 {
				sampleAt = at.Add(2 * time.Second)
			}
			receipt, err := restored.Accept(telemetryBatchFixture(sampleAt, want), at.Add(time.Minute), 60)
			if err != nil || receipt.AcceptedCount != 0 || receipt.DuplicateCount != 1 {
				t.Fatal("checkpoint not atomic with committed history", receipt, err)
			}
			t.Logf("killed after %s: persisted fast count=%d, matching checkpoint restored", phase, want)
		})
	}
}

func TestTelemetryRecorderCrashChild(t *testing.T) {
	phase := os.Getenv("VIORKA_CRASH_TEST_PHASE")
	if phase == "" {
		t.Skip("subprocess helper")
	}
	if phase != "accepted" && phase != "committed" {
		t.Fatal("invalid child phase")
	}
	path := os.Getenv("VIORKA_CRASH_TEST_DB")
	if !filepath.IsAbs(path) {
		t.Fatal("invalid child database path")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	at := time.Date(2026, 11, 2, 0, 0, 2, 0, time.UTC)
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	r, err := monitoring.NewTelemetryRecorder(ctx, s, at)
	if err != nil {
		t.Fatal(err)
	}
	if err = r.BindRun("n", telemetryTestRun, at); err != nil {
		t.Fatal(err)
	}
	receipt, err := r.Accept(telemetryBatchFixture(at, 2), at, 60)
	if err != nil || receipt.AcceptedCount != 1 {
		t.Fatal("child ingress not accepted", receipt, err)
	}
	if phase == "committed" {
		if err = r.Flush(ctx, at, true); err != nil {
			t.Fatal(err)
		}
	}
	fmt.Println("ready " + phase)
	// Parent holds stdin open and kills us; no timeout sleep or graceful shutdown.
	var one [1]byte
	_, _ = os.Stdin.Read(one[:])
	t.Fatal("parent did not kill child at boundary")
}
