package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type telemetryLoadWire struct{ read, written, connections atomic.Uint64 }
type telemetryLoadConn struct {
	net.Conn
	totals *telemetryLoadWire
}

func (c *telemetryLoadConn) Read(p []byte) (int, error) {
	n, e := c.Conn.Read(p)
	c.totals.read.Add(uint64(n))
	return n, e
}
func (c *telemetryLoadConn) Write(p []byte) (int, error) {
	n, e := c.Conn.Write(p)
	c.totals.written.Add(uint64(n))
	return n, e
}

// Fifty protocol clients, a real TLS router and SQLite. Resource observations
// include the load generator in this process, NOT fifty real Agent collectors.
// Fixed 3 waves preserve the actual R=60 wall interval; no accelerated timers.
func TestTelemetryFiftyNodesHTTP(t *testing.T)     { testTelemetryFiftyNodes(t, false) }
func TestTelemetryFiftyNodesRealtime(t *testing.T) { testTelemetryFiftyNodes(t, true) }
func testTelemetryFiftyNodes(t *testing.T, realtime bool) {
	gate, channel, waves, interval, expectedFast := "VIORKA_TEST_LOAD_HTTP", "http", 3, 60*time.Second, uint64(6)
	if realtime {
		gate, channel, waves, interval, expectedFast = "VIORKA_TEST_LOAD_WSS", "wss", 121, time.Second, 121
	}
	if os.Getenv(gate) != "1" {
		t.Skip("set " + gate + "=1 and VIORKA_TEST_LOAD_OUTPUT")
	}
	if runtime.GOOS != "linux" {
		t.Fatal("load resource evidence requires Linux")
	}
	outputPath := os.Getenv("VIORKA_TEST_LOAD_OUTPUT")
	if !filepath.IsAbs(outputPath) {
		t.Fatal("absolute new output path required")
	}
	file, err := os.OpenFile(outputPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	encoder := json.NewEncoder(file)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	f := setupConfigured(t, "admin", true)
	// Preserve the fixture's actual HTTP/gateway ingress instance.
	var wire telemetryLoadWire
	transport := f.server.Client().Transport.(*http.Transport).Clone()
	transport.MaxIdleConns = 100
	transport.MaxIdleConnsPerHost = 50
	dial := &net.Dialer{Timeout: 5 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		conn, err := dial.DialContext(ctx, network, address)
		if err != nil {
			return nil, err
		}
		wire.connections.Add(1)
		return &telemetryLoadConn{conn, &wire}, nil
	}
	client := &http.Client{Transport: transport}
	defer transport.CloseIdleConnections()
	raw, err := os.ReadFile("../../api/agent/v1/examples/node.metrics.v3.json")
	if err != nil {
		t.Fatal(err)
	}
	var example struct {
		Payload v1.TelemetryBatch `json:"payload"`
	}
	if err := json.Unmarshal(raw, &example); err != nil {
		t.Fatal(err)
	}
	type peer struct {
		node, token, generation string
		conn                    *websocket.Conn
	}
	peers := make([]peer, 0, 50)
	for i := 0; i < 50; i++ {
		node, key := f.enroll()
		if realtime {
			settings := v1.DefaultTelemetrySettings()
			settings.WssReportSeconds = 1
			if _, err := f.store.SaveTelemetrySettings(ctx, "user", node, settings); err != nil {
				t.Fatal(err)
			}
		}
		token := f.token(node, key)
		conn, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(f.server.URL, "https")+"/api/v1/agents/ws", &websocket.DialOptions{HTTPClient: client, HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}}})
		if err != nil {
			t.Fatal(err)
		}
		defer conn.CloseNow()

		send(tWriter{t, conn}, v1.Message("system.hello", node, auth.Random(), v1.Hello{ProtocolVersions: []string{v1.Version}, Capabilities: []string{v1.TelemetryCapability}}))
		if receive(t, conn).Type != "system.hello_ack" {
			t.Fatal("missing hello acknowledgement")
		}
		ready := receive(t, conn)
		var settings v1.TelemetryReady
		if ready.Type != "node.telemetry.ready" || v1.DecodeTelemetry(ready.Payload, &settings, false) != nil || settings.Settings == nil {
			t.Fatal("missing ready")
		}
		peers = append(peers, peer{node, token, settings.SessionGeneration, conn})
		result := v1.Message("node.settings.v3_result", node, auth.Random(), v1.TelemetrySettingsResult{Revision: settings.Settings.Revision, AppliedRevision: settings.Settings.Revision, State: "applied"})
		result.CorrelationID = ready.MessageID
		send(tWriter{t, conn}, result)
	}
	// HTTP activation happens asynchronously in each gateway reader.
	readyTick := time.NewTicker(10 * time.Millisecond)
	defer readyTick.Stop()
	for {
		ready := true
		for _, p := range peers {
			snapshot, err := f.gate.ReadMetrics(p.node, monitoring.Cursor{}, true)
			if err != nil {
				t.Fatal(err)
			}
			if snapshot.Telemetry == nil || snapshot.Telemetry.Settings == nil {
				ready = false
				break
			}
		}
		if ready {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("activation deadline")
		case <-readyTick.C:
		}
	}
	if realtime {
		ids := make([]string, len(peers))
		for i, p := range peers {
			ids[i] = p.node
		}
		subscription, err := f.gate.SubscribeTelemetry(ids)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { subscription.Close(time.Now()) }()
		for _, p := range peers {
			command := receive(t, p.conn)
			if err := ackTelemetryLoadDemand(ctx, p.conn, p.node, p.generation, command); err != nil {
				t.Fatal(err)
			}
		}
	}
	// Keep management heartbeats alive while HTTP reports independently.
	heartbeatCtx, stopHeartbeat := context.WithCancel(ctx)
	heartbeatDone := make(chan struct{})
	heartbeatErrors := make(chan error, 1)
	go func() {
		defer close(heartbeatDone)
		if realtime {
			return
		} // WSS load writers send heartbeats in-band.
		tick := time.NewTicker(30 * time.Second)
		defer tick.Stop()
		for {
			select {
			case <-heartbeatCtx.Done():
				return
			case <-tick.C:
				for _, p := range peers {
					raw, _ := json.Marshal(v1.Message("node.heartbeat", p.node, auth.Random(), v1.Heartbeat{}))
					if err := p.conn.Write(heartbeatCtx, websocket.MessageText, raw); err != nil {
						select {
						case heartbeatErrors <- err:
						default:
						}
						return
					}
				}
			}
		}
	}()
	defer func() { stopHeartbeat(); <-heartbeatDone }()
	started := time.Now()
	sizes := func(path string) (int64, error) {
		stat, err := os.Stat(path)
		if os.IsNotExist(err) {
			return 0, nil
		}
		if err != nil {
			return 0, err
		}
		return stat.Size(), nil
	}
	record := func(kind string, extra map[string]any) {
		t.Helper()
		stats, err := readSoakProcess(os.Getpid())
		if err != nil {
			t.Fatal(err)
		}
		db, err := sizes(f.dbPath)
		if err != nil {
			t.Fatal(err)
		}
		wal, err := sizes(f.dbPath + "-wal")
		if err != nil {
			t.Fatal(err)
		}
		if extra == nil {
			extra = map[string]any{}
		}
		extra["kind"], extra["elapsed_seconds"], extra["process"], extra["goroutines"] = kind, time.Since(started).Seconds(), stats, runtime.NumGoroutine()
		extra["db_bytes"], extra["wal_bytes"] = db, wal
		extra["client_wire_read_bytes"], extra["client_wire_written_bytes"], extra["client_tcp_connections_created"] = wire.read.Load(), wire.written.Load(), wire.connections.Load()
		if err := encoder.Encode(extra); err != nil {
			t.Fatal(err)
		}
	}
	record("start", map[string]any{"channel": channel, "nodes": 50, "collection_seconds": 30, "report_seconds": 60, "scope": "Panel plus synthetic clients; TLS wire counts exclude enrollment/challenge"})
	var latencies, flushLatencies []float64
	var payloadBytes uint64
	flushTick := time.NewTicker(5 * time.Second)
	defer flushTick.Stop()
	sampleTick := time.NewTicker(10 * time.Second)
	defer sampleTick.Stop()
	nextWave := time.NewTimer(0)
	defer nextWave.Stop()
	wave := 0
	for wave < waves {
		select {
		case <-ctx.Done():
			t.Fatal("load deadline")
		case err := <-heartbeatErrors:
			t.Fatal(err)
		case <-sampleTick.C:
			record("resource", nil)
		case <-flushTick.C:
			at := time.Now()
			work, stop := context.WithTimeout(ctx, 5*time.Second)
			err := f.recorder.Flush(work, at, false)
			stop()
			if err != nil {
				t.Fatal(err)
			}
			flushLatencies = append(flushLatencies, time.Since(at).Seconds())
		case <-nextWave.C:
			at := time.Now().UTC()
			type outcome struct {
				latency float64
				bytes   uint64
				err     error
			}
			results := make(chan outcome, 50)
			var wg sync.WaitGroup
			for _, p := range peers {
				wg.Add(1)
				go func(p peer) {
					defer wg.Done()
					batch := example.Payload
					batch.NodeID = p.node
					batch.BatchID = fmt.Sprintf("load-%d", wave)
					first, second, full := *batch.Fast[0], *batch.Fast[0], *batch.Full[0]
					first.Sequence, second.Sequence, full.Sequence = uint64(wave*2+1), uint64(wave*2+2), uint64(wave+1)
					first.SampledAt, second.SampledAt, full.SampledAt = at.Add(-30*time.Second), at, at
					batch.Fast, batch.Full = []*v1.TelemetryFast{&first, &second}, []*v1.TelemetryFull{&full}
					if realtime {
						second.Sequence, second.ElapsedSeconds = uint64(wave+1), 1
						batch.Fast = []*v1.TelemetryFast{&second}
						batch.Full = []*v1.TelemetryFull{}
						if wave%60 == 0 {
							full.Sequence = uint64(wave/60 + 1)
							batch.Full = []*v1.TelemetryFull{&full}
						}
						before := time.Now()
						requestCtx, stop := context.WithTimeout(ctx, 5*time.Second)
						defer stop()
						if wave%30 == 0 {
							raw, _ := json.Marshal(v1.Message("node.heartbeat", p.node, auth.Random(), v1.Heartbeat{}))
							if err := p.conn.Write(requestCtx, websocket.MessageText, raw); err != nil {
								results <- outcome{err: err}
								return
							}
						}
						message := v1.Message("node.metrics.v3", p.node, auth.Random(), batch)
						raw, err := json.Marshal(message)
						if err != nil {
							results <- outcome{err: err}
							return
						}
						if err = p.conn.Write(requestCtx, websocket.MessageText, raw); err != nil {
							results <- outcome{err: err}
							return
						}
						for {
							_, body, err := p.conn.Read(requestCtx)
							if err != nil {
								results <- outcome{err: err}
								return
							}
							var reply v1.Envelope
							if err := json.Unmarshal(body, &reply); err != nil {
								results <- outcome{err: err}
								return
							}
							if reply.Type == "node.metrics.demand" {
								if err := ackTelemetryLoadDemand(requestCtx, p.conn, p.node, p.generation, reply); err != nil {
									results <- outcome{err: err}
									return
								}
								continue
							}
							var receipt v1.TelemetryReceipt
							if reply.Type != "node.metrics.receipt" || reply.CorrelationID != message.MessageID || v1.DecodeTelemetry(reply.Payload, &receipt, false) != nil || receipt.AcceptedCount != uint64(1+len(batch.Full)) || receipt.DuplicateCount != 0 {
								results <- outcome{err: fmt.Errorf("WSS receipt rejected: %s", receipt.ErrorCode)}
								return
							}
							results <- outcome{time.Since(before).Seconds(), uint64(len(raw)), nil}
							return
						}
					}
					raw, err := json.Marshal(batch)
					if err != nil {
						results <- outcome{err: err}
						return
					}
					requestCtx, stopRequest := context.WithTimeout(ctx, 10*time.Second)
					defer stopRequest()
					req, err := http.NewRequestWithContext(requestCtx, "POST", f.server.URL+"/api/v1/agents/metrics", bytes.NewReader(raw))
					if err != nil {
						results <- outcome{err: err}
						return
					}
					req.Header.Set("Content-Type", "application/json")
					req.Header.Set("Authorization", "Bearer "+p.token)
					before := time.Now()
					response, err := client.Do(req)
					if err != nil {
						results <- outcome{err: err}
						return
					}
					body, readErr := io.ReadAll(io.LimitReader(response.Body, 16385))
					response.Body.Close()
					var receipt v1.TelemetryReceipt
					if readErr != nil || response.StatusCode != 200 || json.Unmarshal(body, &receipt) != nil || receipt.AcceptedCount != 3 || receipt.DuplicateCount != 0 {
						results <- outcome{err: fmt.Errorf("upload rejected status=%d", response.StatusCode)}
						return
					}
					results <- outcome{time.Since(before).Seconds(), uint64(len(raw)), nil}
				}(p)
			}
			wg.Wait()
			close(results)
			rejected := 0
			var firstFailure error
			for result := range results {
				if result.err != nil {
					rejected++
					if firstFailure == nil {
						firstFailure = result.err
					}
					continue
				}
				latencies = append(latencies, result.latency)
				payloadBytes += result.bytes
			}
			if rejected > 0 {
				record("failed_wave", map[string]any{"wave": wave, "accepted_requests": 50 - rejected, "failed_requests": rejected})
				t.Fatalf("wave %d: %d/50 requests failed; first: %v", wave, rejected, firstFailure)
			}
			wave++
			if wave < waves {
				due := started.Add(time.Duration(wave) * interval)
				if realtime && time.Now().After(due) {
					record("missed_deadline", map[string]any{"wave": wave})
					t.Fatal("real-time load cannot sustain W=1 without catch-up")
				}
				nextWave.Reset(time.Until(due))
			}
		}
	}
	at := time.Now()
	if err := f.recorder.Flush(ctx, at, true); err != nil {
		t.Fatal(err)
	}
	flushLatencies = append(flushLatencies, time.Since(at).Seconds())
	for _, p := range peers {
		rows, err := f.store.TelemetryHistory(ctx, p.node, started.Add(-time.Minute), time.Now().Add(time.Minute), time.Now(), 30)
		if err != nil {
			t.Fatal(err)
		}
		var fast, full uint64
		for _, row := range rows {
			fast += row.FastCount
			full += row.FullCount
		}
		if fast != expectedFast || full != 3 {
			t.Fatalf("node counts fast=%d full=%d", fast, full)
		}
		node, err := f.store.Node(ctx, p.node)
		if err != nil || node.State != "online" {
			t.Fatal("management heartbeat lost", err)
		}
	}
	sort.Float64s(latencies)
	sort.Float64s(flushLatencies)
	record("complete", map[string]any{"requests": len(latencies), "payload_bytes": payloadBytes, "receipt_p95_seconds": latencies[(len(latencies)*95-1)/100], "receipt_max_seconds": latencies[len(latencies)-1], "flush_calls": len(flushLatencies), "flush_max_seconds": flushLatencies[len(flushLatencies)-1], "channel": channel, "fast_points": 50 * expectedFast, "full_points": 150})
	if err := file.Sync(); err != nil {
		t.Fatal(err)
	}
}

func ackTelemetryLoadDemand(ctx context.Context, conn *websocket.Conn, node, generation string, command v1.Envelope) error {
	var demand v1.TelemetryDemand
	if command.Type != "node.metrics.demand" || v1.DecodeTelemetry(command.Payload, &demand, false) != nil || demand.Validate(generation) != nil || !demand.Enabled {
		return fmt.Errorf("invalid load demand")
	}
	result := v1.Message("node.metrics.demand_result", node, auth.Random(), v1.TelemetryDemandResult{SessionGeneration: generation, DemandRevision: demand.DemandRevision, LeaseID: demand.LeaseID, State: "applied", Mode: "realtime"})
	result.CorrelationID = command.MessageID
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	return conn.Write(ctx, websocket.MessageText, raw)
}
