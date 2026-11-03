package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type lostTelemetryReceipt struct {
	batch v1.TelemetryBatch
	at    time.Time
}
type telemetryReceiptProxy struct {
	armed    atomic.Bool
	lost     chan lostTelemetryReceipt
	accepted func(v1.TelemetryBatch)
}

// Relay actual management frames through the real Gateway, dropping only one
// accepted metric receipt. Settings, demands, heartbeats and tasks still pass.
func (p *telemetryReceiptProxy) wrap(t *testing.T, next http.Handler) http.Handler {
	backend := httptest.NewTLSServer(next)
	t.Cleanup(backend.Close)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/agents/ws" {
			next.ServeHTTP(w, r)
			return
		}
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		upstream, _, err := websocket.Dial(ctx, "wss"+strings.TrimPrefix(backend.URL, "https")+r.URL.RequestURI(), &websocket.DialOptions{HTTPClient: backend.Client(), HTTPHeader: http.Header{"Authorization": r.Header.Values("Authorization")}})
		if err != nil {
			http.Error(w, "test relay unavailable", 502)
			return
		}
		defer upstream.CloseNow()
		downstream, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer downstream.CloseNow()
		upstream.SetReadLimit(1 << 20)
		downstream.SetReadLimit(1 << 20)
		var mu sync.Mutex
		var last v1.TelemetryBatch
		var lastID string
		done := make(chan struct{})
		go func() {
			defer close(done)
			defer cancel()
			for {
				kind, raw, err := downstream.Read(ctx)
				if err != nil {
					return
				}
				var e v1.Envelope
				if json.Unmarshal(raw, &e) == nil && e.Type == "node.metrics.v3" {
					var batch v1.TelemetryBatch
					if err := json.Unmarshal(e.Payload, &batch); err != nil {
						t.Error(err)
						return
					}
					mu.Lock()
					last, lastID = batch, e.MessageID
					mu.Unlock()
				}
				if err := upstream.Write(ctx, kind, raw); err != nil {
					return
				}
			}
		}()
		defer func() { cancel(); downstream.CloseNow(); upstream.CloseNow(); <-done }()
		for {
			kind, raw, err := upstream.Read(ctx)
			if err != nil {
				return
			}
			var e v1.Envelope
			if json.Unmarshal(raw, &e) == nil && e.Type == "node.metrics.receipt" {
				var receipt v1.TelemetryReceipt
				if json.Unmarshal(e.Payload, &receipt) == nil && receipt.State == "accepted" {
					mu.Lock()
					batch, id := last, lastID
					mu.Unlock()
					if e.CorrelationID != id || receipt.BatchID != batch.BatchID {
						t.Error("receipt relay correlation mismatch")
						return
					}
					if err := receipt.Validate(uint64(len(batch.Fast) + len(batch.Full) + len(batch.PublicIp))); err != nil {
						t.Error(err)
						return
					}
					if p.accepted != nil {
						p.accepted(batch)
					}
					if receipt.AcceptedCount > 0 && p.armed.CompareAndSwap(true, false) {
						p.lost <- lostTelemetryReceipt{batch: batch, at: time.Now()}
						continue
					}
				}
			}
			if err := downstream.Write(ctx, kind, raw); err != nil {
				return
			}
		}
	})
}
