package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/monitoring"
)

// This is deliberately opt-in. A short smoke run checks the harness, never the
// duration requirement. One Agent and one in-process Panel remain alive throughout.
func TestTelemetryAgentSoak(t *testing.T) {
	raw := os.Getenv("VIORKA_TEST_SOAK_DURATION")
	if raw == "" {
		t.Skip("set VIORKA_TEST_SOAK_DURATION and VIORKA_TEST_SOAK_OUTPUT")
	}
	duration, err := time.ParseDuration(raw)
	if err != nil || duration < time.Minute || duration > 72*time.Hour {
		t.Fatal("soak duration must be between 1m and 72h")
	}
	if !filepath.IsAbs(os.Getenv("VIORKA_TEST_SOAK_OUTPUT")) {
		t.Fatal("soak output must be an absolute new file")
	}
	testTelemetryAgentProcess(t, false, duration)
}

type telemetryTestLog struct {
	mu        sync.Mutex
	file      *os.File
	remaining int
}

func (w *telemetryTestLog) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	n := min(len(p), w.remaining)
	if n > 0 {
		written, err := w.file.Write(p[:n])
		w.remaining -= written
		if err != nil {
			return written, err
		}
	}
	return len(p), nil
}

type soakProcessStats struct {
	RSSBytes       uint64 `json:"rss_bytes"`
	CPUUserTicks   uint64 `json:"cpu_user_ticks"`
	CPUSystemTicks uint64 `json:"cpu_system_ticks"`
	FDs            int    `json:"fds"`
	SocketFDs      int    `json:"socket_fds"`
	ReadBytes      uint64 `json:"read_bytes"`
	WriteBytes     uint64 `json:"write_bytes"`
}

// A renewal is pending until its own ACK arrives, even while the previous
// lease is still valid. Outside authenticated session recovery, permit only
// that bounded transition, not degraded mode or an indefinitely missing ACK.
type soakModeCheck struct {
	pendingSince, recoveryUntil time.Time
	sessionEpoch                uint64
}

// Only a newly issued authenticated credential authorizes recovery time.
// Repeated issuance cannot keep extending an unresolved recovery window.
func (c *soakModeCheck) session(epoch uint64, now time.Time, report time.Duration) bool {
	if epoch == 0 || epoch < c.sessionEpoch {
		return false
	}
	if c.sessionEpoch == 0 {
		c.sessionEpoch = epoch
		return true
	}
	if epoch == c.sessionEpoch {
		return true
	}
	if epoch != c.sessionEpoch+1 || now.Before(c.recoveryUntil) {
		return false
	}
	c.sessionEpoch = epoch
	c.recoveryUntil = now.Add(report + 45*time.Second)
	c.pendingSince = time.Time{}
	return true
}

func (c *soakModeCheck) healthy(mode, expected string, now, changed time.Time) bool {
	if now.Before(c.recoveryUntil) || now.Sub(changed) <= 45*time.Second || mode == expected {
		c.pendingSince = time.Time{}
		return true
	}
	if mode != "pending" || expected != "realtime" {
		return false
	}
	if c.pendingSince.IsZero() {
		c.pendingSince = now
	}
	return now.Sub(c.pendingSince) <= 15*time.Second
}

func TestSoakModeCheckRenewalBound(t *testing.T) {
	now := time.Now()
	changed := now.Add(-time.Minute)
	var check soakModeCheck
	if !check.healthy("realtime", "realtime", now, changed) || !check.healthy("pending", "realtime", now, changed) || !check.healthy("pending", "realtime", now.Add(15*time.Second), changed) {
		t.Fatal("valid renewal transition rejected")
	}
	if check.healthy("pending", "realtime", now.Add(16*time.Second), changed) {
		t.Fatal("missing renewal ACK accepted indefinitely")
	}
	if !check.healthy("realtime", "realtime", now.Add(17*time.Second), changed) || !check.pendingSince.IsZero() {
		t.Fatal("ACK did not reset transition timer")
	}
	for _, mode := range []string{"http", "degraded", ""} {
		if check.healthy(mode, "realtime", now, changed) {
			t.Fatalf("unexpected mode accepted: %q", mode)
		}
	}
	if check.healthy("pending", "http", now, changed) {
		t.Fatal("unsettled disable accepted")
	}
}

func TestSoakModeCheckAuthenticatedSessionRecovery(t *testing.T) {
	now := time.Now()
	changed := now.Add(-time.Minute)
	var check soakModeCheck
	if !check.session(1, now, 60*time.Second) || check.healthy("degraded", "realtime", now, changed) {
		t.Fatal("initial session hid degradation")
	}
	if !check.session(2, now, 60*time.Second) || !check.healthy("degraded", "realtime", now.Add(104*time.Second), changed) {
		t.Fatal("credential renewal did not grant bounded recovery")
	}
	if check.session(3, now.Add(time.Second), 60*time.Second) {
		t.Fatal("repeated credentials extended recovery")
	}
	if check.healthy("degraded", "realtime", now.Add(105*time.Second), changed) {
		t.Fatal("degradation survived recovery deadline")
	}
	if !check.healthy("realtime", "realtime", now.Add(106*time.Second), changed) || !check.session(3, now.Add(15*time.Minute), 60*time.Second) {
		t.Fatal("later healthy renewal failed")
	}
	if check.session(2, now.Add(16*time.Minute), 60*time.Second) {
		t.Fatal("session generation regressed")
	}
}

// Linux procfs counters are kept as raw ticks/bytes: no invented CPU percentage
// or network-byte estimate. Socket descriptors are not TCP connection counts.
func readSoakProcess(pid int) (soakProcessStats, error) {
	var out soakProcessStats
	root := fmt.Sprintf("/proc/%d", pid)
	raw, err := os.ReadFile(root + "/stat")
	if err != nil {
		return out, err
	}
	end := strings.LastIndexByte(string(raw), ')')
	if end < 0 {
		return out, fmt.Errorf("invalid process stat")
	}
	fields := strings.Fields(string(raw[end+1:]))
	if len(fields) < 22 {
		return out, fmt.Errorf("short process stat")
	}
	parse := func(value string) (uint64, error) { return strconv.ParseUint(value, 10, 64) }
	if out.CPUUserTicks, err = parse(fields[11]); err != nil {
		return out, err
	}
	if out.CPUSystemTicks, err = parse(fields[12]); err != nil {
		return out, err
	}
	pages, err := parse(fields[21])
	if err != nil {
		return out, err
	}
	out.RSSBytes = pages * uint64(os.Getpagesize())
	entries, err := os.ReadDir(root + "/fd")
	if err != nil {
		return out, err
	}
	out.FDs = len(entries)
	for _, entry := range entries {
		target, err := os.Readlink(root + "/fd/" + entry.Name())
		if os.IsNotExist(err) {
			continue
		} // descriptor may close during this snapshot
		if err != nil {
			return out, err
		}
		if strings.HasPrefix(target, "socket:[") {
			out.SocketFDs++
		}
	}
	raw, err = os.ReadFile(root + "/io")
	if err != nil {
		return out, err
	}
	for _, line := range strings.Split(string(raw), "\n") {
		pair := strings.Fields(line)
		if len(pair) != 2 {
			continue
		}
		switch pair[0] {
		case "read_bytes:":
			out.ReadBytes, err = parse(pair[1])
		case "write_bytes:":
			out.WriteBytes, err = parse(pair[1])
		}
		if err != nil {
			return out, err
		}
	}
	return out, nil
}

func runTelemetrySoak(t *testing.T, ctx context.Context, f *fixture, node, run string, pid int, duration time.Duration, sessionEpoch func() uint64) {
	t.Helper()
	if runtime.GOOS != "linux" {
		t.Fatal("resource soak requires Linux procfs")
	}
	file, err := os.OpenFile(os.Getenv("VIORKA_TEST_SOAK_OUTPUT"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	output := json.NewEncoder(file)
	started := time.Now()
	deadline := started.Add(duration)
	tick := time.NewTicker(10 * time.Second)
	defer tick.Stop()
	// The subscription type belongs to the demand service; retain its bounded
	// close operation without introducing a second subscriber implementation.
	var closeDemand func(time.Time)
	defer func() {
		if closeDemand != nil {
			closeDemand(time.Now())
		}
	}()
	var previous uint64
	lastAdvance := started
	changed := started
	previousMode := false
	var modeCheck soakModeCheck
	rows := 0
	size := func(path string) int64 {
		stat, err := os.Stat(path)
		if os.IsNotExist(err) {
			return 0
		}
		if err != nil {
			t.Fatal(err)
		}
		return stat.Size()
	}
	for {
		now := time.Now()
		if !modeCheck.session(sessionEpoch(), now, 60*time.Second) {
			t.Fatal("unexpected repeated session issuance during recovery")
		}
		wantsRealtime := (int(now.Sub(started)/(5*time.Minute)) % 2) == 1
		if wantsRealtime != previousMode {
			if wantsRealtime {
				subscription, err := f.gate.SubscribeTelemetry([]string{node})
				if err != nil {
					t.Fatal(err)
				}
				closeDemand = subscription.Close
			} else {
				closeDemand(now)
				closeDemand = nil
			}
			previousMode, changed = wantsRealtime, now
		}
		snapshot, err := f.gate.ReadMetrics(node, monitoring.Cursor{}, true)
		if err != nil {
			t.Fatal(err)
		}
		if snapshot.Telemetry == nil || snapshot.Telemetry.RunID != run {
			t.Fatal("soak lost run identity")
		}
		if snapshot.Sequence < previous {
			t.Fatal("soak sequence regressed")
		}
		if snapshot.Sequence > previous {
			previous, lastAdvance = snapshot.Sequence, now
		}
		if now.Sub(lastAdvance) > 3*time.Minute {
			t.Fatal("soak observations stopped advancing")
		}
		expected := "http"
		if wantsRealtime {
			expected = "realtime"
		}
		if snapshot.TelemetryControl == nil || !modeCheck.healthy(snapshot.TelemetryControl.Mode, expected, now, changed) {
			t.Fatalf("soak mode did not settle: expected=%s control=%+v sequence=%d last_advance_ago=%s phase_age=%s", expected, snapshot.TelemetryControl, snapshot.Sequence, now.Sub(lastAdvance), now.Sub(changed))
		}
		panel, err := readSoakProcess(os.Getpid())
		if err != nil {
			t.Fatal(err)
		}
		agent, err := readSoakProcess(pid)
		if err != nil {
			t.Fatal(err)
		}
		var memory runtime.MemStats
		runtime.ReadMemStats(&memory)
		row := map[string]any{"at": now.UTC(), "elapsed_seconds": now.Sub(started).Seconds(), "sequence": snapshot.Sequence, "mode": snapshot.TelemetryControl.Mode, "fast_stale": snapshot.Telemetry.FastStale, "panel": panel, "agent": agent, "panel_goroutines": runtime.NumGoroutine(), "panel_heap_bytes": memory.HeapAlloc, "db_bytes": size(f.dbPath), "wal_bytes": size(f.dbPath + "-wal"), "session_epoch": modeCheck.sessionEpoch, "session_recovery_remaining_seconds": max(0, modeCheck.recoveryUntil.Sub(now).Seconds()), "observation_window_complete": !now.Before(deadline)}
		if err = output.Encode(row); err != nil {
			t.Fatal(err)
		}
		rows++
		if size(file.Name()) > 16<<20 || rows > 26000 {
			t.Fatal("soak evidence budget exceeded")
		}
		if err = file.Sync(); err != nil {
			t.Fatal(err)
		}
		if !now.Before(deadline) {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-tick.C:
		}
	}
	flush, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err = f.recorder.Flush(flush, time.Now(), true); err != nil {
		t.Fatal(err)
	}
	history, err := f.store.MetricHistory(flush, node, time.Now().Add(-time.Hour), time.Now(), 30)
	if err != nil || len(history.Points) == 0 {
		t.Fatal("soak history missing", err)
	}
	t.Logf("continuous soak completed: duration=%s evidence_rows=%d history_points=%d", duration, rows, len(history.Points))
}

func TestTelemetryTestLogBound(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "log")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	writer := &telemetryTestLog{file: file, remaining: 7}
	for i := 0; i < 3; i++ {
		if n, err := writer.Write([]byte("12345")); n != 5 || err != nil {
			t.Fatal(n, err)
		}
	}
	raw, err := os.ReadFile(file.Name())
	if err != nil || string(raw) != "1234512" {
		t.Fatal(string(raw), err)
	}
}

func TestTelemetrySoakProcfs(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux procfs required")
	}
	stats, err := readSoakProcess(os.Getpid())
	if err != nil || stats.RSSBytes == 0 || stats.FDs < 3 {
		t.Fatal(stats, err)
	}
}
