package monitoring

import (
	"context"
	"errors"
	"reflect"
	"sync"
	"time"

	v1 "github.com/vioira/viorka/protocol/v1"
)

var ErrTelemetrySession = errors.New("telemetry session is not negotiated")
var ErrTelemetryRate = errors.New("telemetry admission rate exceeded")

type telemetryBinding struct {
	tcpProbe                 bool
	session, generation, run string
	expires                  time.Time
	settings                 v1.TelemetrySettings
	creditAt                 time.Time
	requests, bytes          float64
}

// TelemetryIngress is shared by HTTP and WSS. Each transport must authenticate
// the bearer against the credential repository on every admission; a cached
// negotiation never grants identity authorization. Session keys are token hashes,
// never raw tokens. Negotiations survive management disconnect until expiry.
type TelemetryIngress struct {
	live     *telemetryLiveCache
	notify   func(string)
	mu       sync.Mutex
	recorder *TelemetryRecorder
	bindings map[string]*telemetryBinding
	parsing  chan struct{}
}

func NewTelemetryIngress(r *TelemetryRecorder) *TelemetryIngress {
	return &TelemetryIngress{live: newTelemetryLiveCache(), recorder: r, bindings: map[string]*telemetryBinding{}, parsing: make(chan struct{}, 8)}
}

// Activate follows a successful ready/settings-result exchange on an
// authenticated management connection. The caller supplies server-owned settings
// and generation. A repeated exchange preserves the run and rate budget.
func (s *TelemetryIngress) Activate(node, session, generation string, expires time.Time, settings v1.TelemetrySettings, now time.Time, tcpProbe ...bool) error {
	if node == "" || len(node) > 128 || len(session) != 64 || generation == "" || len(generation) > 128 || !expires.After(now) || settings.Validate() != nil {
		return ErrTelemetrySession
	}
	s.mu.Lock()
	changed := false
	defer func() {
		notify := s.notify
		s.mu.Unlock()
		if changed && notify != nil {
			notify(node)
		}
	}()
	for id, b := range s.bindings {
		if !b.expires.After(now) {
			delete(s.bindings, id)
		}
	}
	if old := s.bindings[node]; old != nil && old.session == session {
		if settings.Revision < old.settings.Revision || (settings.Revision == old.settings.Revision && !reflect.DeepEqual(settings, old.settings)) {
			return ErrTelemetrySession
		}
		old.tcpProbe = len(tcpProbe) > 0 && tcpProbe[0]
		old.generation = generation
		old.expires = expires
		old.settings = settings
		if entry, ok := s.live.entries[node]; ok {
			entry.settings = settings
			s.live.entries[node] = entry
		}
		changed = true
		return nil
	}
	if len(s.bindings) >= MaxNodes && s.bindings[node] == nil {
		return ErrTelemetryOverloaded
	}
	if entry, ok := s.live.entries[node]; ok {
		entry.settings = settings
		s.live.entries[node] = entry
	}
	s.bindings[node] = &telemetryBinding{tcpProbe: len(tcpProbe) > 0 && tcpProbe[0], session: session, generation: generation, expires: expires, settings: settings, creditAt: now, requests: 32, bytes: 2 * v1.TelemetryMaxBodyBytes}
	changed = true
	return nil
}

// Forget removes negotiation on identity reset/deletion, never merely on WSS
// disconnect. The caller coordinates deletion with active gateway sessions.
func (s *TelemetryIngress) Forget(node string) {
	s.mu.Lock()
	delete(s.bindings, node)
	s.live.forget(node)
	s.mu.Unlock()
}

// Receive returns a receipt only after a batch ID has been safely decoded.
// HTTP uses an empty generation; WSS must use its server-owned generation.
// Rate budgets are shared across transports, including malformed attempts.
func (s *TelemetryIngress) Receive(ctx context.Context, node, session, generation string, raw []byte, http bool, now time.Time) (v1.TelemetryReceipt, error) {
	empty := v1.TelemetryReceipt{}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	limit := v1.TelemetryMaxFrameBytes
	if http {
		limit = v1.TelemetryMaxBodyBytes
	}
	if len(raw) > limit {
		return empty, v1.ErrTelemetryPayload
	}
	s.mu.Lock()
	b := s.bindings[node]
	if b == nil || b.session != session || !b.expires.After(now) || (!http && b.generation != generation) {
		s.mu.Unlock()
		return empty, ErrTelemetrySession
	}
	elapsed := now.Sub(b.creditAt).Seconds()
	if elapsed > 0 {
		b.requests = min(32, b.requests+elapsed*16)
		b.bytes = min(2*v1.TelemetryMaxBodyBytes, b.bytes+elapsed*v1.TelemetryMaxBodyBytes)
		b.creditAt = now
	}
	if b.requests < 1 || b.bytes < float64(len(raw)) {
		s.mu.Unlock()
		return empty, ErrTelemetryRate
	}
	b.requests--
	b.bytes -= float64(len(raw))
	settings := b.settings
	gen := b.generation
	s.mu.Unlock()
	select {
	case s.parsing <- struct{}{}:
		defer func() { <-s.parsing }()
	default:
		return empty, ErrTelemetryOverloaded
	}
	batch, err := v1.DecodeTelemetryBatch(raw, node, now, settings.HttpReportSeconds, http)
	if err != nil {
		return empty, err
	}
	reply := v1.TelemetryReceipt{BatchID: batch.BatchID, State: "rejected", ErrorCode: "stale_session"}
	var notify func(string)
	s.mu.Lock()
	defer func() {
		s.mu.Unlock()
		if notify != nil {
			notify(node)
		}
	}()
	// Decode happens outside the lock. A superseding session/settings exchange
	// must not let this already-in-flight request mutate history afterward.
	if s.bindings[node] != b || b.generation != gen || !reflect.DeepEqual(b.settings, settings) || !b.expires.After(now) {
		return reply, ErrTelemetrySession
	}
	if err = ctx.Err(); err != nil {
		return reply, err
	}
	for _, full := range batch.Full {
		if len(full.TcpProbes) > 0 && !b.tcpProbe {
			return reply, v1.ErrTelemetryPayload
		}
	}
	if b.run != "" && b.run != batch.RunID {
		return reply, ErrTelemetryRun
	}
	next, err := s.live.prepare(batch, now, settings, s.recorder.watermarks(node, batch.RunID))
	if err != nil {
		reply.ErrorCode = "overloaded"
		return reply, err
	}
	if b.run == "" {
		if err = s.recorder.BindRun(node, batch.RunID, now); err != nil {
			reply.ErrorCode = "overloaded"
			return reply, err
		}
		b.run = batch.RunID
	}
	accepted, err := s.recorder.Accept(batch, now, settings.HttpReportSeconds)
	if err == nil && accepted.State == "accepted" {
		s.live.commit(node, next)
		notify = s.notify
	}
	return accepted, err
}

// SetNotifier installs a startup callback. Notifications happen after both
// accepted history and live state are visible, outside the ingress mutex.
func (s *TelemetryIngress) SetNotifier(notify func(string)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.notify = notify
}
func (s *TelemetryIngress) Live(node string, now time.Time, cursor Cursor, realtime, summary bool) (TelemetryLiveSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out, err := s.live.get(node, now, cursor, realtime, summary)
	if binding := s.bindings[node]; binding != nil {
		applied := binding.settings
		out.Settings = &applied
	}
	return out, err
}
