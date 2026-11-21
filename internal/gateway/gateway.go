package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

const agentStopping = websocket.StatusCode(4001)

type Repository interface {
	AgentStopped(context.Context, string) error
	Online(context.Context, string, v1.Hello) error
	SaveInventory(context.Context, string, v1.NodeInventory) error
	Heartbeat(context.Context, string) error
	HeartbeatTimeout(context.Context) (time.Duration, error)
	Claim(context.Context, string) (*v1.TaskDispatch, error)
	Reply(context.Context, string, string, v1.TaskReply) error
}
type Gateway struct {
	telemetryStatus    map[string]telemetryStatus
	demands            *monitoring.Demands
	demandWake         map[string]chan struct{}
	telemetryNodes     map[string]bool
	telemetry          *monitoring.TelemetryIngress
	events             *realtime.Hub
	recorder           *monitoring.TelemetryRecorder
	repo               Repository
	auth               *auth.Agents
	mu                 sync.Mutex
	connections        map[string]context.CancelFunc
	settingsWake       map[string]chan struct{}
	forgetOnDisconnect map[string]bool
	closed             bool
	wg                 sync.WaitGroup
}

func New(repo Repository, a *auth.Agents) *Gateway {
	var events *realtime.Hub
	if source, ok := repo.(realtime.Source); ok {
		events = source.Events()
	}
	g := &Gateway{telemetryStatus: map[string]telemetryStatus{}, demandWake: map[string]chan struct{}{}, telemetryNodes: map[string]bool{}, events: events, repo: repo, auth: a, connections: map[string]context.CancelFunc{}, settingsWake: map[string]chan struct{}{}, forgetOnDisconnect: map[string]bool{}}
	g.demands = monitoring.NewDemands(g.notifyDemand)
	return g
}
func (g *Gateway) SetRecorder(r *monitoring.TelemetryRecorder) { g.recorder = r }

// NotifySettings never writes a socket from an HTTP request goroutine.
func (g *Gateway) NotifySettings(id string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if ch := g.settingsWake[id]; ch != nil {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

// WithDisconnectedNode excludes connecting sessions while replacing credentials.
func (g *Gateway) WithDisconnectedNode(node string, reset func() error) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.connections[node] != nil {
		return auth.ErrConflict
	}
	err := reset()
	if err == nil && g.telemetry != nil {
		g.telemetry.Forget(node)
	}
	return err
}
func (g *Gateway) Revoke(id string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.telemetry != nil {
		g.telemetry.Forget(id)
	}
	if cancel := g.connections[id]; cancel != nil {
		cancel()
	}
}
func (g *Gateway) Close() {
	g.mu.Lock()
	g.closed = true
	for _, cancel := range g.connections {
		cancel()
	}
	g.mu.Unlock()
	g.wg.Wait()
}
func (g *Gateway) Serve(w http.ResponseWriter, r *http.Request, token, node string, expires time.Time) {
	ctx, cancel := context.WithDeadline(r.Context(), expires)
	defer cancel()
	g.mu.Lock()
	if g.closed || len(g.connections) >= 1024 || g.connections[node] != nil {
		g.mu.Unlock()
		http.Error(w, "connection unavailable", http.StatusConflict)
		return
	}
	// Recheck after acquiring the connection lock: credentials may have been reset
	// since HTTP authentication, before this connection was registered.
	if _, _, err := g.auth.Authenticate(ctx, token); err != nil {
		g.mu.Unlock()
		http.Error(w, "identity unavailable", http.StatusUnauthorized)
		return
	}
	g.connections[node] = cancel
	settingsWake := make(chan struct{}, 1)
	g.settingsWake[node] = settingsWake
	demandWake := make(chan struct{}, 1)
	g.demandWake[node] = demandWake
	g.wg.Add(1)
	g.mu.Unlock()
	defer func() {
		g.mu.Lock()
		delete(g.connections, node)
		delete(g.settingsWake, node)
		delete(g.demandWake, node)
		delete(g.telemetryNodes, node)
		delete(g.telemetryStatus, node)
		if g.forgetOnDisconnect[node] {
			g.forgetMetricsLocked(node)
			delete(g.forgetOnDisconnect, node)
		}
		g.mu.Unlock()
		if g.events != nil {
			g.events.Publish(realtime.Change{Kind: "metrics", NodeID: node})
		}
		g.wg.Done()
	}()
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(v1.MaxEngineRecoveryReplyBytes)
	var recoveryTask atomic.Pointer[string]
	incoming := make(chan v1.Envelope, 8)
	readDone := make(chan struct{})
	var peerStopped, online bool
	go func() {
		defer close(readDone)
		defer cancel()
		for {
			typ, b, e := conn.Read(ctx)
			if e != nil {
				peerStopped = websocket.CloseStatus(e) == agentStopping
				return
			}
			if typ != websocket.MessageText {
				return
			}
			var envelope v1.Envelope
			if task := recoveryTask.Load(); task != nil {
				envelope, e = v1.ParseEngineRecoveryReply(b, node, *task)
			} else {
				envelope, e = v1.Parse(b, node)
			}
			if e != nil {
				return
			}
			select {
			case incoming <- envelope:
			case <-ctx.Done():
				return
			default:
				return
			}
		}
	}()
	defer func() {
		cancel()
		conn.CloseNow()
		<-readDone
		// This handler still owns the node slot, so a new hello cannot race this write.
		if online && peerStopped {
			save, stop := context.WithTimeout(context.Background(), 3*time.Second)
			defer stop()
			if _, _, err := g.auth.Authenticate(save, token); err == nil {
				if err := g.repo.AgentStopped(save, node); err != nil {
					slog.Error("persist agent shutdown failed", "node_id", node, "error", err)
				}
			}
		}
	}()
	send := func(e v1.Envelope) error {
		c, stop := context.WithTimeout(ctx, 5*time.Second)
		defer stop()
		b, err := json.Marshal(e)
		if err != nil {
			return err
		}
		return conn.Write(c, websocket.MessageText, b)
	}
	helloTimeout := time.NewTimer(10 * time.Second)
	defer helloTimeout.Stop()
	var h v1.Hello
	select {
	case e := <-incoming:
		if e.Type != "system.hello" || v1.Decode(e.Payload, &h) != nil || !slices.Contains(h.ProtocolVersions, v1.Version) || len(h.Capabilities) > 32 || len(h.AgentVersion) > 64 || len(h.OS) > 64 || len(h.Arch) > 64 {
			return
		}
	case <-ctx.Done():
		return
	case <-helloTimeout.C:
		return
	}
	if err = g.repo.Online(ctx, node, h); err != nil {
		return
	}
	ack := v1.HelloAck{ProtocolVersion: v1.Version, HeartbeatSeconds: 30}
	inventoryEnabled := slices.Contains(h.Capabilities, "node.inventory.v1")
	if inventoryEnabled {
		version := uint64(1)
		ack.InventoryVersion = &version
	}
	helloReply := v1.Message("system.hello_ack", node, auth.Random(), ack)
	if err = send(helloReply); err != nil {
		return
	}
	online = true
	var telemetry *telemetrySession
	if g.telemetry != nil && slices.Contains(h.Capabilities, v1.TelemetryCapability) {
		repo, ok := g.repo.(telemetryRepository)
		if !ok {
			return
		}
		g.mu.Lock()
		g.telemetryNodes[node] = true
		g.mu.Unlock()
		telemetry = &telemetrySession{
			activationAck:             slices.Contains(h.Capabilities, v1.TelemetryActivationCapability),
			dailyTrafficSupported:     g.telemetry.DailyTrafficEnabled() && slices.Contains(h.Capabilities, v1.DailyTrafficCapability),
			tcpProbeSettingsSupported: slices.Contains(h.Capabilities, v1.TCPProbeSettingsCapability),
			tcpProbeSupported:         slices.Contains(h.Capabilities, v1.TCPProbeCapability),
			trafficSupported:          slices.Contains(h.Capabilities, v1.TrafficCapability),
			ingress:                   g.telemetry,
			repo:                      repo,
			node:                      node,
			token:                     token,
			generation:                auth.Random(),
			expires:                   expires,
		}
		if err = telemetry.push(ctx, send, true); err != nil {
			return
		}
	}
	backupRepo, hasBackupRepo := g.repo.(interface {
		EngineEndpointBackups(context.Context, string) ([]v1.EngineEndpointBackup, error)
	})
	syncEndpoints := hasBackupRepo && slices.Contains(h.Capabilities, v1.EngineEndpointsCapability)
	var endpointWake <-chan struct{}
	var endpointChanges *realtime.Subscription
	if syncEndpoints && g.events != nil {
		endpointChanges = g.events.Subscribe(func(change realtime.Change) bool { return change.Kind == "engines" && change.NodeID == node })
		defer endpointChanges.Close()
		endpointWake = endpointChanges.Wake
	}
	var nextEndpointSync time.Time
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	last := time.Now()
	window := time.Now()
	count := 0
	for {
		if telemetry != nil {
			g.publishTelemetryStatus(node, telemetry)
		}
		select {
		case <-ctx.Done():
			return
		case <-endpointWake:
			endpointChanges.Drain()
			nextEndpointSync = time.Time{}
		case <-demandWake:
			if telemetry != nil {
				if err = telemetry.pushDemand(g.demands.State(node), time.Now(), send); err != nil {
					return
				}
			}
		case <-settingsWake:
			if telemetry != nil {
				if err = telemetry.push(ctx, send, false); err != nil {
					return
				}
			}
		case e := <-incoming:
			metricAdmission := telemetry != nil && e.Type == "node.metrics.v3" && telemetry.demandError(time.Now()) == ""
			if !metricAdmission {
				count++
			}
			if time.Since(window) >= time.Minute {
				window = time.Now()
				count = 0
				if !metricAdmission {
					count = 1
				}
			}
			if count > 120 && !metricAdmission {
				return
			}
			switch e.Type {
			case "node.settings.v3_result":
				if telemetry == nil {
					return
				}
				wasApplied := telemetry.applied
				// Serialize activation with revoke/reset/delete cleanup so a late
				// settings receipt cannot recreate a forgotten negotiation.
				g.mu.Lock()
				_, _, err = g.auth.Authenticate(ctx, token)
				if err == nil {
					err = telemetry.result(ctx, e)
				}
				g.mu.Unlock()
				if err != nil {
					return
				}
				if telemetry.activationAck && !wasApplied && telemetry.applied {
					activated := v1.Message("node.telemetry.activated", node, auth.Random(), v1.TelemetryActivated{SessionGeneration: telemetry.generation})
					activated.CorrelationID = e.MessageID
					if err = send(activated); err != nil {
						return
					}
				}
				if err = telemetry.pushDemand(g.demands.State(node), time.Now(), send); err != nil {
					return
				}
			case "node.metrics.demand_result":
				if telemetry == nil || telemetry.demandResult(e, time.Now()) != nil {
					return
				}
			case "node.metrics.v3":
				if telemetry == nil || telemetry.receive(ctx, g.auth, e, send) != nil {
					return
				}
			case "node.inventory":
				var inventory v1.NodeInventory
				if !inventoryEnabled || e.Revision != nil || e.CorrelationID != "" || v1.Decode(e.Payload, &inventory) != nil || inventory.Validate(time.Now()) != nil {
					return
				}
				if err = g.repo.SaveInventory(ctx, node, inventory); err != nil && !errors.Is(err, auth.ErrConflict) {
					return
				}
			case "node.heartbeat":
				var h v1.Heartbeat
				if v1.Decode(e.Payload, &h) != nil {
					return
				}
				last = time.Now()
				if err = g.repo.Heartbeat(ctx, node); err != nil {
					return
				}
			case "task.ack", "task.result":
				var reply v1.TaskReply
				var decodeErr error
				dispatchedRecovery := recoveryTask.Load()
				if e.Type == "task.result" && dispatchedRecovery != nil && *dispatchedRecovery == e.CorrelationID {
					decodeErr = v1.DecodeEngineRecoveryReply(e.Payload, &reply)
				} else {
					decodeErr = v1.Decode(e.Payload, &reply)
				}
				if decodeErr != nil || e.CorrelationID != reply.TaskID || e.Revision != nil {
					return
				}
				if err = g.repo.Reply(ctx, node, e.Type, reply); err != nil && !errors.Is(err, auth.ErrConflict) {
					return
				}
				if err == nil && e.Type == "task.result" && dispatchedRecovery != nil && *dispatchedRecovery == reply.TaskID {
					recoveryTask.Store(nil)
				}
			default:
				return
			}
		case <-tick.C:
			if telemetry != nil {
				if err = telemetry.pushDemand(g.demands.State(node), time.Now(), send); err != nil {
					return
				}
			}
			if telemetry != nil && telemetry.pending != "" && time.Since(telemetry.pendingAt) > 30*time.Second {
				return
			}
			expired, timeoutErr := g.heartbeatExpired(ctx, last, time.Now())
			if timeoutErr != nil {
				slog.Error("read heartbeat timeout failed", "node_id", node)
				return
			}
			if expired {
				return
			}
			if _, _, err = g.auth.Authenticate(ctx, token); err != nil {
				return
			}
			if slices.Contains(h.Capabilities, "node.inspect") {
				var task *v1.TaskDispatch
				var e error
				if slices.Contains(h.Capabilities, v1.EngineCapability) {
					if repo, ok := g.repo.(interface {
						ClaimEngines(context.Context, string) (*v1.TaskDispatch, error)
					}); ok {
						task, e = repo.ClaimEngines(ctx, node)
					}
				}
				if e != nil {
					return
				}
				if task == nil {
					if repo, ok := g.repo.(interface {
						ClaimSupported(context.Context, string, bool) (*v1.TaskDispatch, error)
					}); ok {
						task, e = repo.ClaimSupported(ctx, node, slices.Contains(h.Capabilities, v1.TrafficCapability))
					} else {
						task, e = g.repo.Claim(ctx, node)
					}
				}
				if e != nil {
					return
				}
				if task != nil {
					if task.Operation == v1.EngineRecoverOperation {
						recoveryTask.Store(&task.TaskID)
					} else {
						recoveryTask.Store(nil)
					}
					msg := v1.Message("task.dispatch", node, auth.Random(), task)
					msg.CorrelationID = task.TaskID
					if send(msg) != nil {
						return
					}
				}
			}
			if syncEndpoints && !time.Now().Before(nextEndpointSync) {
				backups, err := backupRepo.EngineEndpointBackups(ctx, node)
				if err != nil {
					return
				}
				for _, b := range backups {
					if err := send(v1.Message("engine.endpoints", node, auth.Random(), b)); err != nil {
						return
					}
				}
				nextEndpointSync = time.Now().Add(30 * time.Second)
			}
		}
	}
}

// ForgetMetrics defers cache removal until the active ingestion loop has
// stopped, preventing an in-flight message from recreating it.
func (g *Gateway) ForgetMetrics(node string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.telemetry != nil {
		g.telemetry.Forget(node)
	}
	if g.connections[node] != nil {
		g.forgetOnDisconnect[node] = true
		return
	}
	g.forgetMetricsLocked(node)
}
func (g *Gateway) forgetMetricsLocked(node string) {
	if g.recorder != nil {
		g.recorder.Forget(node)
	}
}

// Avoid policy reads while no supported timeout could have elapsed.
func (g *Gateway) heartbeatExpired(ctx context.Context, last, now time.Time) (bool, error) {
	if now.Sub(last) <= 60*time.Second {
		return false, nil
	}
	c, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	timeout, err := g.repo.HeartbeatTimeout(c)
	if err != nil {
		return false, err
	}
	return now.Sub(last) > timeout, nil
}
