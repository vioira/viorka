package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/scheduler"
	v1 "github.com/vioira/viorka/protocol/v1"
)

// Opt-in cross-repository test: build the real Agent CLI and supply its absolute
// path. No module replacement or test-only Agent implementation is used.
func TestTelemetryAgentProcess(t *testing.T)                 { testTelemetryAgentProcess(t, false, 0) }
func TestTelemetryAgentProcessManagementOutage(t *testing.T) { testTelemetryAgentProcess(t, true, 0) }
func TestTelemetryAgentProcessLostPOSTResponse(t *testing.T) {
	testTelemetryAgentProcessFault(t, false, 0, processFault{loseResponse: true})
}
func testTelemetryAgentProcess(t *testing.T, outage bool, soak time.Duration) {
	testTelemetryAgentProcessFault(t, outage, soak, processFault{})
}
func TestTelemetryAgentProcessRefusalsAndTasks(t *testing.T) {
	testTelemetryAgentProcessFault(t, false, 0, processFault{refuseUploads: true})
}

func TestTelemetryAgentProcessThirtyPointBatch(t *testing.T) {
	testTelemetryAgentProcessFault(t, false, 0, processFault{steadyBatch: true})
}

func TestTelemetryAgentProcessLostWSSReceipt(t *testing.T) {
	testTelemetryAgentProcessFault(t, false, 0, processFault{loseWSSReceipt: true})
}

func TestTelemetryAgentProcessScheduledSessionRefresh(t *testing.T) {
	testTelemetryAgentProcessFault(t, false, 0, processFault{shortSession: true})
}

type processFault struct{ loseResponse, refuseUploads, steadyBatch, loseWSSReceipt, shortSession bool }

func testTelemetryAgentProcessFault(t *testing.T, outage bool, soak time.Duration, fault processFault) {
	binary := os.Getenv("VIORKA_TEST_AGENT_BINARY")
	if binary == "" {
		t.Skip("set VIORKA_TEST_AGENT_BINARY to a locally built Agent CLI")
	}
	if !filepath.IsAbs(binary) {
		t.Fatal("Agent binary must be absolute")
	}
	ctx, cancel := context.WithTimeout(context.Background(), soak+8*time.Minute)
	defer cancel()
	type acceptedPOST struct {
		batch v1.TelemetryBatch
		at    time.Time
	}
	accepted := make(chan acceptedPOST, 2)
	var posts atomic.Uint64
	var sessionsIssued atomic.Uint64
	var refreshedAt atomic.Int64
	var refusing atomic.Bool
	refusals := make(chan time.Time, 4)
	var refusalCount atomic.Uint64
	var blocked atomic.Bool
	var denied atomic.Uint64
	var socketMu sync.Mutex
	var closeSocket context.CancelFunc
	var observedMu sync.Mutex
	observed := map[uint64]time.Time{}
	observe := func(batch v1.TelemetryBatch) {
		observedMu.Lock()
		defer observedMu.Unlock()
		for _, sample := range batch.Fast {
			if old, exists := observed[sample.Sequence]; exists && !old.Equal(sample.SampledAt) {
				t.Error("reused fast identity changed sampled_at")
			}
			if len(observed) >= 4096 {
				t.Error("test observation limit exceeded")
				return
			}
			observed[sample.Sequence] = sample.SampledAt
		}
	}
	receiptProxy := &telemetryReceiptProxy{lost: make(chan lostTelemetryReceipt, 1), accepted: observe}
	f := setupConfiguredMiddleware(t, "admin", true, func(next http.Handler) http.Handler {
		if fault.loseWSSReceipt {
			next = receiptProxy.wrap(t, next)
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if (fault.shortSession || soak > 0) && r.URL.Path == "/api/v1/agents/session" {
				response := httptest.NewRecorder()
				next.ServeHTTP(response, r)
				if response.Code != 200 {
					t.Error("session fixture failed", response.Code)
					w.WriteHeader(response.Code)
					return
				}
				var result map[string]any
				if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
					t.Error(err)
					w.WriteHeader(500)
					return
				}
				// Only shorten the first client-side lifetime. Signatures, credentials and
				// replacement session issuance still use the real authentication service.
				issued := sessionsIssued.Add(1)
				if issued == 2 {
					refreshedAt.Store(time.Now().UnixNano())
				}
				if issued == 1 && fault.shortSession {
					result["expires_at"] = time.Now().Add(140 * time.Second).UTC().Format(time.RFC3339Nano)
				}
				for k, values := range response.Header() {
					w.Header()[k] = values
				}
				_ = json.NewEncoder(w).Encode(result)
				return
			}
			if refusing.Load() && r.URL.Path == "/api/v1/agents/metrics" {
				refusalCount.Add(1)
				select {
				case refusals <- time.Now():
				default:
				}
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", "30")
				w.WriteHeader(http.StatusServiceUnavailable)
				_, _ = io.WriteString(w, `{"code":"overloaded","message":"isolated test refusal"}`)
				return
			}
			if (fault.loseResponse || fault.steadyBatch || fault.loseWSSReceipt || fault.shortSession) && r.URL.Path == "/api/v1/agents/metrics" && (posts.Add(1) <= 2 || fault.loseWSSReceipt) {
				at := time.Now()
				raw, err := io.ReadAll(io.LimitReader(r.Body, (1<<20)+1))
				if err != nil || len(raw) > 1<<20 {
					t.Error("invalid test upload", err)
					http.Error(w, "invalid upload", 400)
					return
				}
				var batch v1.TelemetryBatch
				if err := json.Unmarshal(raw, &batch); err != nil {
					t.Error(err)
					http.Error(w, "invalid upload", 400)
					return
				}
				r.Body = io.NopCloser(bytes.NewReader(raw))
				response := httptest.NewRecorder()
				next.ServeHTTP(response, r)
				var receipt v1.TelemetryReceipt
				if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &receipt) != nil || receipt.Validate(uint64(len(batch.Fast)+len(batch.Full)+len(batch.PublicIp))) != nil || (receipt.AcceptedCount == 0 && !fault.shortSession) {
					t.Error("captured upload has no valid acceptance receipt", response.Code, response.Body.String())
				}
				if fault.loseWSSReceipt {
					observe(batch)
				}
				if posts.Load() <= 2 {
					accepted <- acceptedPOST{batch, at}
				}
				if fault.loseResponse && posts.Load() == 1 {
					// Abort only after the real authenticated ingress has accepted the batch.
					// net/http closes the connection (or resets HTTP/2), delivering no receipt.
					panic(http.ErrAbortHandler)
				}
				for k, values := range response.Header() {
					w.Header()[k] = values
				}
				w.WriteHeader(response.Code)
				_, _ = w.Write(response.Body.Bytes())
				return
			}
			if r.URL.Path != "/api/v1/agents/ws" {
				next.ServeHTTP(w, r)
				return
			}
			socketMu.Lock()
			if blocked.Load() {
				socketMu.Unlock()
				denied.Add(1)
				http.Error(w, "test management outage", http.StatusServiceUnavailable)
				return
			}
			requestCtx, stop := context.WithCancel(r.Context())
			closeSocket = stop
			socketMu.Unlock()
			defer stop()
			next.ServeHTTP(w, r.WithContext(requestCtx))
		})
	})
	if soak > 0 {
		flushCtx, stopFlush := context.WithCancel(ctx)
		flushDone := make(chan struct{})
		go func() { defer close(flushDone); f.recorder.Run(flushCtx) }()
		defer func() { stopFlush(); <-flushDone }()
	}
	enrollment, err := f.agents.CreateEnrollment(ctx, "user", "process-fixture", "nat")
	if err != nil {
		t.Fatal(err)
	}
	settings := v1.DefaultTelemetrySettings()
	settings.CollectionSeconds = 2
	settings.HttpReportSeconds = 30
	settings.WssReportSeconds = 1
	if fault.steadyBatch {
		settings.HttpReportSeconds = 60
	}
	if soak > 0 || fault.shortSession {
		settings = v1.DefaultTelemetrySettings()
	}
	if _, err = f.store.SaveTelemetrySettings(ctx, "user", enrollment.ID, settings); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	ca := filepath.Join(dir, "ca.pem")
	if err = os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: f.server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	cfg := filepath.Join(dir, "agent.json")
	raw, _ := json.Marshal(map[string]any{"panel_url": f.server.URL, "node_name": "process-fixture", "state_dir": filepath.Join(dir, "state"), "ca_file": ca, "telemetry_v3": true})
	if err = os.WriteFile(cfg, raw, 0600); err != nil {
		t.Fatal(err)
	}
	enroll := exec.CommandContext(ctx, binary, "enroll", "--config", cfg, "--token-stdin")
	enroll.Stdin = strings.NewReader(enrollment.Token + "\n")
	if output, err := enroll.CombinedOutput(); err != nil {
		t.Fatalf("enrollment: %v: %s", err, output)
	}
	command := exec.CommandContext(ctx, binary, "run", "--config", cfg)
	command.WaitDelay = 5 * time.Second
	// Do not pipe unlimited process logs into test memory.
	logPath := filepath.Join(dir, "agent.log")
	if soak > 0 {
		// Preserve bounded diagnostics after TempDir cleanup, including failures.
		logPath = os.Getenv("VIORKA_TEST_SOAK_OUTPUT") + ".agent.log"
	}
	log, err := os.OpenFile(logPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer log.Close()
	boundedLog := &telemetryTestLog{file: log, remaining: 8 << 20}
	command.Stdout = boundedLog
	command.Stderr = boundedLog
	if err = command.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	stopped := false
	defer func() {
		if !stopped {
			command.Process.Kill()
			<-done
		}
	}()
	read := func() monitoring.LiveSnapshot {
		value, err := f.gate.ReadMetrics(enrollment.ID, monitoring.Cursor{}, false)
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	await := func(label string, check func(monitoring.LiveSnapshot) bool) monitoring.LiveSnapshot {
		t.Helper()
		tick := time.NewTicker(50 * time.Millisecond)
		defer tick.Stop()
		for {
			value := read()
			if check(value) {
				return value
			}
			select {
			case err := <-done:
				stopped = true
				t.Fatalf("Agent exited before %s: %v", label, err)
			case <-ctx.Done():
				t.Fatalf("timeout awaiting %s", label)
			case <-tick.C:
			}
		}
	}
	httpSnapshot := await("HTTP observation without viewers", func(v monitoring.LiveSnapshot) bool {
		return v.Telemetry != nil && v.Telemetry.Fast != nil && v.TelemetryControl.Mode == "http"
	})
	run := httpSnapshot.Telemetry.RunID
	if run == "" || httpSnapshot.Telemetry.Settings.CollectionSeconds != settings.CollectionSeconds {
		t.Fatal("missing negotiated settings/run")
	}
	if fault.steadyBatch {
		var first acceptedPOST
		select {
		case first = <-accepted:
		case <-ctx.Done():
			t.Fatal("missing accepted steady batch")
		}
		if len(first.batch.Fast) != 30 {
			t.Fatalf("C2/R60 first batch: got %d points, want 30", len(first.batch.Fast))
		}
		counts := map[int64]uint64{}
		for i, sample := range first.batch.Fast {
			counts[sample.SampledAt.Unix()/30*30]++
			if i > 0 {
				previous := first.batch.Fast[i-1]
				gap := sample.SampledAt.Sub(previous.SampledAt)
				if sample.Sequence <= previous.Sequence || gap < 1500*time.Millisecond || gap > 2500*time.Millisecond {
					t.Fatalf("sample identity/cadence lost: %d gap=%s", i, gap)
				}
			}
		}
		if len(counts) < 2 || len(counts) > 3 {
			t.Fatal("sample timestamps did not span real UTC buckets", counts)
		}
		if err := f.recorder.Flush(ctx, time.Now(), true); err != nil {
			t.Fatal(err)
		}
		now := time.Now()
		rows, err := f.store.TelemetryHistory(ctx, enrollment.ID, now.Add(-5*time.Minute), now.Add(time.Minute), now, 30)
		if err != nil {
			t.Fatal(err)
		}
		var total uint64
		for _, row := range rows {
			if row.FastCount != counts[row.Start] {
				t.Fatalf("UTC bucket mismatch: %+v expected=%v", row, counts)
			}
			total += row.FastCount
		}
		if total != 30 {
			t.Fatal("batch samples lost or duplicated at persistence", total)
		}
		t.Logf("C2/R60: 30 original samples persisted across %d UTC buckets", len(counts))
	}
	if fault.refuseUploads {
		refusing.Store(true)
		tasks := scheduler.New(f.store)
		var previousRefusal time.Time
		for attempt := 0; attempt < 3; attempt++ {
			var at time.Time
			select {
			case at = <-refusals:
			case <-ctx.Done():
				t.Fatal("missing refusal", ctx.Err())
			}
			if !previousRefusal.IsZero() && at.Sub(previousRefusal) < 29*time.Second {
				t.Fatal("refusal bypassed R")
			}
			previousRefusal = at
			task, err := tasks.Create(ctx, "user", enrollment.ID, "node.inspect", fmt.Sprintf("during-refusal-%d", attempt))
			if err != nil {
				t.Fatal(err)
			}
			await("task completes during metric refusal", func(v monitoring.LiveSnapshot) bool {
				result, err := tasks.Get(ctx, task.ID)
				if err != nil {
					t.Fatal(err)
				}
				if result.State == "failed" {
					t.Fatal("task failed during refusal", result.ErrorCode)
				}
				if v.Sequence != httpSnapshot.Sequence {
					t.Fatal("refused metrics unexpectedly accepted")
				}
				return result.State == "succeeded" && len(result.Result) > 0
			})
		}
		refusing.Store(false)
		recovered := await("metrics recover after third refusal backoff", func(v monitoring.LiveSnapshot) bool {
			return v.Telemetry != nil && v.Sequence > httpSnapshot.Sequence
		})
		elapsed := time.Since(previousRefusal)
		if elapsed < 119*time.Second || refusalCount.Load() != 3 || recovered.Telemetry.RunID != run {
			t.Fatal("refusal ladder/reset/run invariant", elapsed, refusalCount.Load())
		}
		t.Logf("three HTTP refusals with three successful tasks; third-refusal recovery after %s, sequence %d -> %d", elapsed, httpSnapshot.Sequence, recovered.Sequence)
		httpSnapshot = recovered
	}
	if fault.loseResponse {
		getPOST := func() acceptedPOST {
			t.Helper()
			select {
			case p := <-accepted:
				return p
			case <-ctx.Done():
				t.Fatal("missing accepted POST after response loss")
				return acceptedPOST{}
			}
		}
		first, second := getPOST(), getPOST()
		if len(first.batch.Fast) < 2 || len(second.batch.Fast) != 1 {
			t.Fatalf("failed window replayed: first=%d second=%d", len(first.batch.Fast), len(second.batch.Fast))
		}
		last := first.batch.Fast[len(first.batch.Fast)-1]
		if second.batch.RunID != first.batch.RunID || second.batch.Fast[0].Sequence <= last.Sequence || !second.batch.Fast[0].SampledAt.After(last.SampledAt) {
			t.Fatal("recovery did not preserve run and use a newer original sample")
		}
		// Allow one second for local request scheduling; the configured R is 30s.
		if elapsed := second.at.Sub(first.at); elapsed < 29*time.Second {
			t.Fatal("POST retry bypassed R", elapsed)
		}
		if err := f.recorder.Flush(ctx, time.Now(), true); err != nil {
			t.Fatal(err)
		}
		now := time.Now()
		history, err := f.store.TelemetryHistory(ctx, enrollment.ID, now.Add(-5*time.Minute), now.Add(time.Minute), now, 30)
		if err != nil {
			t.Fatal(err)
		}
		var count uint64
		for _, bucket := range history {
			count += bucket.FastCount
		}
		if count != uint64(len(first.batch.Fast)+len(second.batch.Fast)) {
			t.Fatalf("accepted samples lost or counted twice: count=%d", count)
		}
		httpSnapshot = await("HTTP recovered after lost receipt", func(v monitoring.LiveSnapshot) bool {
			return v.Telemetry != nil && v.Sequence >= second.batch.Fast[0].Sequence
		})
		t.Logf("accepted POST response lost: %d original points, next POST latest sequence %d after %s; persisted count=%d", len(first.batch.Fast), second.batch.Fast[0].Sequence, second.at.Sub(first.at), count)
	}
	demand, err := f.gate.SubscribeTelemetry([]string{enrollment.ID})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { demand.Close(time.Now()) }()
	realtime := await("acknowledged realtime with new sample", func(v monitoring.LiveSnapshot) bool {
		return v.Telemetry != nil && v.TelemetryControl.Mode == "realtime" && v.Sequence > httpSnapshot.Sequence
	})
	if realtime.Telemetry.RunID != run {
		t.Fatal("mode switch reset run")
	}
	if fault.loseWSSReceipt {
		receiptProxy.armed.Store(true)
	}
	tasks := scheduler.New(f.store)
	task, err := tasks.Create(ctx, "user", enrollment.ID, "node.inspect", "while-realtime")
	if err != nil {
		t.Fatal(err)
	}
	await("read-only task result while realtime active", func(v monitoring.LiveSnapshot) bool {
		result, err := tasks.Get(ctx, task.ID)
		if err != nil {
			t.Fatal(err)
		}
		if result.State == "failed" {
			t.Fatalf("inspection failed: %s", result.ErrorCode)
		}
		return result.State == "succeeded" && len(result.Result) > 0 && v.TelemetryControl.Mode == "realtime"
	})
	duplicate, err := tasks.Create(ctx, "user", enrollment.ID, "node.inspect", "while-realtime")
	if err != nil || duplicate.ID != task.ID {
		t.Fatal("task idempotency changed during telemetry")
	}
	if fault.loseWSSReceipt {
		var lost lostTelemetryReceipt
		select {
		case lost = <-receiptProxy.lost:
		case <-ctx.Done():
			t.Fatal("no accepted WSS receipt dropped")
		}
		get := func() acceptedPOST {
			t.Helper()
			select {
			case p := <-accepted:
				return p
			case <-ctx.Done():
				t.Fatal("missing HTTP fallback after WSS receipt timeout")
				return acceptedPOST{}
			}
		}
		baseline, fallback := get(), get()
		if len(lost.batch.Fast) == 0 || len(fallback.batch.Fast) != 1 {
			t.Fatal("fallback replayed failed WSS window")
		}
		last := lost.batch.Fast[len(lost.batch.Fast)-1]
		latest := fallback.batch.Fast[0]
		if fallback.batch.RunID != lost.batch.RunID || latest.Sequence <= last.Sequence || !latest.SampledAt.After(last.SampledAt) {
			t.Fatal("fallback did not retain newer original identity")
		}
		if fallback.at.Sub(baseline.at) < 29*time.Second || fallback.at.Before(lost.at) {
			t.Fatal("fallback bypassed HTTP R")
		}
		recovered := await("WSS resumes after fallback receipt", func(v monitoring.LiveSnapshot) bool {
			if v.Telemetry == nil || v.Telemetry.Fast == nil {
				return false
			}
			seq, err := strconv.ParseUint(v.Telemetry.Fast.Sequence, 10, 64)
			return err == nil && seq > latest.Sequence && v.TelemetryControl.Mode == "realtime"
		})
		if recovered.Telemetry.RunID != run {
			t.Fatal("fallback reset run")
		}
		t.Logf("dropped accepted WSS sequence %d receipt; HTTP latest-only sequence %d after %s since prior POST; realtime resumed", last.Sequence, latest.Sequence, fallback.at.Sub(baseline.at))
	}
	if fault.shortSession {
		await("replacement signed session issued", func(v monitoring.LiveSnapshot) bool { return sessionsIssued.Load() >= 2 })
		get := func() acceptedPOST {
			t.Helper()
			select {
			case p := <-accepted:
				return p
			case <-ctx.Done():
				t.Fatal("no HTTP probe after session refresh")
				return acceptedPOST{}
			}
		}
		first, probe := get(), get()
		if probe.at.Sub(first.at) < time.Duration(settings.HttpReportSeconds-1)*time.Second || probe.batch.RunID != run || len(probe.batch.Fast) != 1 {
			t.Fatal("session refresh bypassed pacing/run/latest-only", probe.at.Sub(first.at), len(probe.batch.Fast))
		}
		latest := probe.batch.Fast[0].Sequence
		recovered := await("existing viewer resumes realtime after session refresh", func(v monitoring.LiveSnapshot) bool {
			if v.Telemetry == nil || v.Telemetry.Fast == nil || v.TelemetryControl.Mode != "realtime" {
				return false
			}
			seq, err := strconv.ParseUint(v.Telemetry.Fast.Sequence, 10, 64)
			return err == nil && seq > latest
		})
		elapsed := time.Since(time.Unix(0, refreshedAt.Load()))
		if elapsed > time.Duration(settings.HttpReportSeconds+45)*time.Second {
			t.Fatal("session refresh recovery exceeded R+45 seconds", elapsed)
		}
		if recovered.Telemetry.RunID != run || sessionsIssued.Load() != 2 {
			t.Fatal("refresh duplicated sessions or reset run", sessionsIssued.Load())
		}
		task, err := tasks.Create(ctx, "user", enrollment.ID, "node.inspect", "after-scheduled-refresh")
		if err != nil {
			t.Fatal(err)
		}
		await("task after scheduled refresh", func(v monitoring.LiveSnapshot) bool {
			result, err := tasks.Get(ctx, task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if result.State == "failed" {
				t.Fatal(result.ErrorCode)
			}
			return result.State == "succeeded" && len(result.Result) > 0
		})
		t.Logf("scheduled credential refresh: exactly two sessions, paced HTTP probe sequence %d after %s, same run and original viewer realtime recovered in %s; task succeeded", latest, probe.at.Sub(first.at), elapsed)
	}
	if outage {
		socketMu.Lock()
		blocked.Store(true)
		if closeSocket == nil {
			socketMu.Unlock()
			t.Fatal("no management socket to interrupt")
		}
		closeSocket()
		socketMu.Unlock()
		disconnected := await("management handler drains before HTTP baseline", func(v monitoring.LiveSnapshot) bool {
			node, err := f.store.Node(ctx, enrollment.ID)
			if err != nil {
				t.Fatal(err)
			}
			return node.State == "offline" && denied.Load() > 0 && v.TelemetryControl != nil && v.TelemetryControl.Mode == "http"
		})
		beforeOutage := disconnected.Sequence
		offline := await("fresh HTTP observations while management unavailable", func(v monitoring.LiveSnapshot) bool {
			node, err := f.store.Node(ctx, enrollment.ID)
			if err != nil {
				t.Fatal(err)
			}
			return node.State == "offline" && denied.Load() > 0 && v.Telemetry != nil && v.TelemetryControl.Mode == "http" && v.Sequence > beforeOutage
		})
		if offline.Telemetry.RunID != run {
			t.Fatal("management outage reset run")
		}
		blocked.Store(false)
		recovered := await("management reconnect restores existing viewer demand", func(v monitoring.LiveSnapshot) bool {
			return v.Telemetry != nil && v.TelemetryControl.Mode == "realtime" && v.Sequence > offline.Sequence
		})
		if recovered.Telemetry.RunID != run {
			t.Fatal("management reconnect reset run")
		}
		reconnectedTask, err := tasks.Create(ctx, "user", enrollment.ID, "node.inspect", "after-reconnect")
		if err != nil {
			t.Fatal(err)
		}
		await("read-only task after management reconnect", func(v monitoring.LiveSnapshot) bool {
			result, err := tasks.Get(ctx, reconnectedTask.ID)
			if err != nil {
				t.Fatal(err)
			}
			if result.State == "failed" {
				t.Fatalf("reconnected inspection failed: %s", result.ErrorCode)
			}
			return result.State == "succeeded" && len(result.Result) > 0
		})
		t.Logf("management outage: HTTP sequence %d, recovered WSS sequence %d, rejected reconnect attempts %d", offline.Sequence, recovered.Sequence, denied.Load())
	}
	demand.Close(time.Now())
	graceEnded := await("last viewer grace expires", func(v monitoring.LiveSnapshot) bool {
		return v.TelemetryControl != nil && v.TelemetryControl.Mode == "http"
	})
	after := await("HTTP resumes without replaying live samples", func(v monitoring.LiveSnapshot) bool {
		return v.Telemetry != nil && v.Sequence > graceEnded.Sequence && v.TelemetryControl.Mode == "http"
	})
	if after.Telemetry.RunID != run {
		t.Fatal("HTTP resumption reset run")
	}
	if soak > 0 {
		runTelemetrySoak(t, ctx, f, enrollment.ID, run, command.Process.Pid, soak, sessionsIssued.Load)
	}
	if err = command.Process.Signal(os.Interrupt); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-done:
		stopped = true
		if err != nil {
			t.Fatalf("Agent shutdown: %v", err)
		}
	case <-ctx.Done():
		t.Fatal("Agent shutdown timed out")
	}
	if fault.loseWSSReceipt {
		if err := f.recorder.Flush(ctx, time.Now(), true); err != nil {
			t.Fatal(err)
		}
		now := time.Now()
		rows, err := f.store.TelemetryHistory(ctx, enrollment.ID, now.Add(-10*time.Minute), now.Add(time.Minute), now, 30)
		if err != nil {
			t.Fatal(err)
		}
		observedMu.Lock()
		defer observedMu.Unlock()
		counts := map[int64]uint64{}
		for _, at := range observed {
			counts[at.Unix()/30*30]++
		}
		var total uint64
		for _, row := range rows {
			if row.FastCount != counts[row.Start] {
				t.Fatalf("fallback SQLite bucket count=%d want=%d at=%d", row.FastCount, counts[row.Start], row.Start)
			}
			total += row.FastCount
		}
		if total != uint64(len(observed)) {
			t.Fatalf("fallback SQLite total=%d unique accepted fast=%d", total, len(observed))
		}
		t.Logf("HTTP/WSS accepted unique fast identities=%d; SQLite per-bucket counts match after shutdown", total)
	}
	t.Logf("real Agent process: HTTP -> WSS -> HTTP, run stable, sequences %d < %d < %d", httpSnapshot.Sequence, realtime.Sequence, after.Sequence)
}
