package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/auth"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type Repository interface {
	Online(context.Context, string, v1.Hello) error
	Heartbeat(context.Context, string) error
	Offline(context.Context, string) error
	Claim(context.Context, string) (*v1.TaskDispatch, error)
	Reply(context.Context, string, string, v1.TaskReply) error
}
type Gateway struct {
	repo        Repository
	auth        *auth.Agents
	mu          sync.Mutex
	connections map[string]context.CancelFunc
	closed      bool
	wg          sync.WaitGroup
}

func New(repo Repository, a *auth.Agents) *Gateway {
	return &Gateway{repo: repo, auth: a, connections: map[string]context.CancelFunc{}}
}
func (g *Gateway) Revoke(id string) {
	g.mu.Lock()
	defer g.mu.Unlock()
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
	g.connections[node] = cancel
	g.wg.Add(1)
	g.mu.Unlock()
	defer func() {
		c, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if err := g.repo.Offline(c, node); err != nil {
			slog.Error("mark node offline failed", "node_id", node)
		}
		g.mu.Lock()
		delete(g.connections, node)
		g.mu.Unlock()
		g.wg.Done()
	}()
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(65536)
	incoming := make(chan v1.Envelope, 8)
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		defer cancel()
		for {
			typ, b, e := conn.Read(ctx)
			if e != nil {
				return
			}
			if typ != websocket.MessageText {
				return
			}
			envelope, e := v1.Parse(b, node)
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
	defer func() { cancel(); conn.CloseNow(); <-readDone }()
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
	if err = send(v1.Message("system.hello_ack", node, auth.Random(), v1.HelloAck{ProtocolVersion: v1.Version, HeartbeatSeconds: 30})); err != nil {
		return
	}
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	last := time.Now()
	window := time.Now()
	count := 0
	for {
		select {
		case <-ctx.Done():
			return
		case e := <-incoming:
			count++
			if time.Since(window) >= time.Minute {
				window = time.Now()
				count = 1
			}
			if count > 120 {
				return
			}
			switch e.Type {
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
				if v1.Decode(e.Payload, &reply) != nil || e.CorrelationID != reply.TaskID || e.Revision != nil {
					return
				}
				if err = g.repo.Reply(ctx, node, e.Type, reply); err != nil && !errors.Is(err, auth.ErrConflict) {
					return
				}
			default:
				return
			}
		case <-tick.C:
			if time.Since(last) > 90*time.Second {
				return
			}
			if _, _, err = g.auth.Authenticate(ctx, token); err != nil {
				return
			}
			if slices.Contains(h.Capabilities, "node.inspect") {
				task, e := g.repo.Claim(ctx, node)
				if e != nil {
					return
				}
				if task != nil {
					msg := v1.Message("task.dispatch", node, auth.Random(), task)
					msg.CorrelationID = task.TaskID
					if send(msg) != nil {
						return
					}
				}
			}
		}
	}
}
