package httpapi

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/realtime"
	"github.com/vioira/viorka/internal/settings"
)

func (a *api) browserSocket(w http.ResponseWriter, r *http.Request, session auth.Session, commands map[string]browserCommand) {
	if !a.allowedOrigin(r) || r.URL.RawQuery != "" {
		fail(w, 403, "origin_rejected", "请求来源不受信任")
		return
	}
	select {
	case a.streams <- struct{}{}:
	default:
		fail(w, 429, "stream_limit", "连接过多，请关闭多余页面")
		return
	}
	defer func() { <-a.streams }()
	// Origin was checked against the exact configured allowlist above.
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true, Subprotocols: []string{"viorka.browser.v1"}})
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(64 << 10)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	r = r.Clone(ctx)
	send := func(frame browserFrame) bool {
		b, err := json.Marshal(frame)
		if err != nil {
			return false
		}
		writeCtx, stop := context.WithTimeout(ctx, 5*time.Second)
		defer stop()
		return conn.Write(writeCtx, websocket.MessageText, b) == nil
	}
	read := func(ctx context.Context) (browserMessage, error) {
		var m browserMessage
		kind, b, err := conn.Read(ctx)
		if err != nil {
			return m, err
		}
		if kind != websocket.MessageText {
			return m, auth.ErrInvalid
		}
		dec := json.NewDecoder(bytes.NewReader(b))
		dec.DisallowUnknownFields()
		if err = dec.Decode(&m); err != nil {
			return m, err
		}
		if dec.Decode(new(any)) != io.EOF {
			return m, auth.ErrInvalid
		}
		return m, nil
	}
	helloCtx, stop := context.WithTimeout(ctx, 5*time.Second)
	hello, err := read(helloCtx)
	stop()
	if err != nil || hello.Type != "hello" || subtle.ConstantTimeCompare([]byte(hello.CSRF), []byte(session.CSRF)) != 1 {
		conn.Close(websocket.StatusPolicyViolation, "会话校验失败")
		return
	}
	cookie, _ := r.Cookie("viorka_session")
	access := func() bool {
		checkCtx, stop := context.WithTimeout(ctx, 5*time.Second)
		defer stop()
		current, err := a.Auth.Session(checkCtx, cookie.Value)
		if err != nil || subtle.ConstantTimeCompare([]byte(current.CSRF), []byte(hello.CSRF)) != 1 {
			conn.Close(websocket.StatusPolicyViolation, "会话已失效")
			return false
		}
		session = current
		return true
	}
	automatic := hello.Enabled
	allowedUpdates := func() bool {
		if a.Settings == nil {
			return true
		}
		checkCtx, stop := context.WithTimeout(ctx, 5*time.Second)
		defer stop()
		value, err := a.Settings.Get(checkCtx)
		return err == nil && value.SSE
	}
	actor := session.User.ID
	sub := a.Events.Subscribe(func(c realtime.Change) bool { return c.UserID == "" || c.UserID == actor })
	defer sub.Close()
	demand, err := a.Gateway.SubscribeTelemetry(nil)
	if err != nil {
		return
	}
	defer func() { demand.Close(time.Now()) }()
	metrics := browserMetrics{a: a, demand: demand}
	defer metrics.clear()
	notify := func() bool {
		items := []settings.Notification{}
		if a.Settings != nil {
			queryCtx, stop := context.WithTimeout(ctx, 5*time.Second)
			var err error
			items, err = a.Settings.Notifications(queryCtx, session.User.ID)
			stop()
			if err != nil {
				return false
			}
		}
		return send(browserFrame{Type: "event", Event: "snapshot", Data: NotificationsResponse{Items: items}})
	}
	if !access() || !notify() || !send(browserFrame{Type: "event", Event: "ready", Data: struct{}{}}) {
		return
	}
	incoming := make(chan browserMessage, 16)
	readerDone := make(chan struct{})
	go func() {
		defer close(readerDone)
		window := time.Now()
		count := 0
		for {
			message, err := read(ctx)
			if err != nil {
				cancel()
				return
			}
			if time.Since(window) >= 10*time.Second {
				window = time.Now()
				count = 0
			}
			count++
			if count > 120 {
				cancel()
				return
			}
			select {
			case incoming <- message:
			case <-ctx.Done():
				return
			}
		}
	}()
	defer func() { cancel(); conn.CloseNow(); <-readerDone }()
	// One bounded command worker leaves the stream reader and event writer free
	// while a database request is in progress. Mutations are never replayed.
	jobs := make(chan browserMessage, 16)
	results := make(chan browserFrame, 16)
	workerDone := make(chan struct{})
	go func() {
		defer close(workerDone)
		for {
			select {
			case <-ctx.Done():
				return
			case m := <-jobs:
				result := executeBrowserCommand(r, hello.CSRF, commands[m.Method], m)
				select {
				case results <- result:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	defer func() { cancel(); <-workerDone }()
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	node := ""
	selectedEngine := ""
	updates := automatic && allowedUpdates()
	reset := func() bool {
		metrics.reset = true
		return notify() && send(browserFrame{Type: "event", Event: "ready", Data: struct{}{}})
	}
	for {
		select {
		case <-ctx.Done():
			return
		case <-a.Shutdown.Done():
			return
		case <-heartbeat.C:
			if !access() {
				conn.Close(websocket.StatusPolicyViolation, "会话已失效")
				return
			}
			pingCtx, stop := context.WithTimeout(ctx, 5*time.Second)
			err := conn.Ping(pingCtx)
			stop()
			if err != nil {
				return
			}
		case result := <-results:
			if !access() || !send(result) {
				return
			}
		case m := <-incoming:
			if !access() {
				return
			}
			switch m.Type {
			case "request":
				if !browserID.MatchString(m.ID) || !browserOperations[m.Method] {
					if !send(browserFrame{Type: "response", ID: m.ID, Status: 400, Data: ErrorResponse{Code: "invalid_request", Message: "不支持的操作"}}) {
						return
					}
					continue
				}
				select {
				case jobs <- m:
				default:
					if !send(browserFrame{Type: "response", ID: m.ID, Status: 429, Data: ErrorResponse{Code: "request_limit", Message: "操作过多，请稍后重试"}}) {
						return
					}
				}
			case "subscribe":
				if m.Node != "" && !browserID.MatchString(m.Node) {
					return
				}
				node = m.Node
				selectedEngine = m.Engine
				automatic = m.Enabled
				updates = automatic && allowedUpdates()
				if !send(browserFrame{Type: "event", Event: "updates", Data: updates}) {
					return
				}
				if !metrics.set(ctx, m.Scope, m.Generation, updates) {
					if !send(browserFrame{Type: "event", Event: "metrics_error", Generation: m.Generation, Data: ErrorResponse{Code: "invalid_scope", Message: "指标订阅不可用，请重新读取"}}) {
						return
					}
				} else if updates && metrics.scope != "" && metrics.reset && !metrics.send(ctx, send) {
					return
				}
			default:
				return
			}
		case <-sub.Wake:
			if !access() {
				return
			}
			changes, overflow := sub.Drain()
			nextUpdates := automatic && allowedUpdates()
			if nextUpdates != updates {
				updates = nextUpdates
				if !metrics.set(ctx, metrics.scope, metrics.generation, updates) {
					return
				}
				if !send(browserFrame{Type: "event", Event: "updates", Data: updates}) {
					return
				}
				if updates && !reset() {
					return
				}
			}
			if !updates {
				continue
			}
			if overflow {
				if !reset() {
					return
				}
				continue
			}
			for _, change := range changes {
				if change.Kind == "access" {
					if !reset() {
						return
					}
					continue
				}
				if change.Kind == "notifications" {
					if !notify() {
						return
					}
					continue
				}
				if change.Kind == "metrics" {
					if metrics.q.node == change.NodeID || (metrics.q.node == "" && change.NodeID <= metrics.q.through) {
						metrics.dirty = true
					}
					continue
				}
				if change.Kind == "nodes" || change.Kind == "node" {
					metrics.dirty = true
				}
				if node != "" && change.NodeID != "" && change.NodeID != node {
					continue
				}
				update := ResourceChange{Change: change}
				queryCtx, stop := context.WithTimeout(ctx, 5*time.Second)
				switch change.Kind {
				case "node":
					value, err := a.Nodes.Node(queryCtx, change.NodeID)
					if err == nil {
						summaries, err := a.Nodes.EngineSummaries(queryCtx, session.User.ID, []string{change.NodeID})
						if err != nil {
							stop()
							return
						}
						if summary, ok := summaries[value.ID]; ok {
							value.Engines = &summary
						}
						update.Node = &value
					} else if errors.Is(err, auth.ErrNotFound) {
						update.Kind = "nodes"
					} else {
						stop()
						return
					}
				case "tasks":
					if change.TaskID != "" {
						task, err := a.Tasks.Get(queryCtx, change.TaskID)
						if err != nil {
							stop()
							return
						}
						value := taskResponse(task)
						update.Task = &value
					}
				case "telemetry_settings", "telemetry_settings_result":
					if change.NodeID == node {
						result := executeBrowserCommand(r, hello.CSRF, commands["getTelemetrySettings"], browserMessage{Params: browserParams{ID: node}})
						if result.Status == 200 {
							update.TelemetrySettings = result.Data.(json.RawMessage)
						}
					}
				case "engines":
					if change.EngineID != "" {
						repo, ok := a.Nodes.(engineRepository)
						if !ok {
							stop()
							return
						}
						engine, err := repo.Engine(queryCtx, session.User.ID, change.EngineID)
						if errors.Is(err, proxy.ErrForbidden) {
							stop()
							continue
						}
						if err != nil {
							stop()
							return
						}
						summary := summarizeEngine(engine)
						update.Engine = &summary
						if engine.ID == selectedEngine {
							update.EngineDetail = &engine
						}
					}
				}
				stop()
				if !send(browserFrame{Type: "event", Event: "change", Data: update}) {
					return
				}
			}
		case <-tick.C:
			if updates && metrics.scope != "" && (metrics.reset || metrics.dirty) && !time.Now().Before(metrics.next) {
				if !access() || !metrics.send(ctx, send) {
					return
				}
			}
		}
	}
}
