package httpapi

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/gateway"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/scheduler"
	"github.com/vioira/viorka/internal/settings"
)

const Version = "0.1.0-m0"

type Dependencies struct {
	History  monitoring.HistoryRepository
	Settings *settings.Service
	Backups  *settings.Backups
	Auth     *auth.Service
	Agents   *auth.Agents
	Nodes    inventory.Repository
	Tasks    *scheduler.Service
	Gateway  *gateway.Gateway
	Ready    func(context.Context) error
	Origin   string
	Shutdown context.Context
}
type api struct {
	Dependencies
	limitMu    sync.Mutex
	limitStart time.Time
	requests   int
	streams    chan struct{}
}

func NewRouter(d Dependencies) http.Handler {
	a := &api{Dependencies: d, streams: make(chan struct{}, 128)}
	m := http.NewServeMux()
	registerRoutes(a, m, newOpenAPI())
	return secureHandler(m)
}

func registerRoutes(a *api, m *http.ServeMux, doc *huma.OpenAPI) {
	d := a.Dependencies
	routes := routeRegistry{mux: m, doc: doc}
	a.registerSettings(routes)
	routes.handle("GET /healthz", "health", "", 200, nil, HealthResponse{}, func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, HealthResponse{Status: "ok"}) })
	routes.handle("GET /readyz", "ready", "", 200, nil, ReadyResponse{}, func(w http.ResponseWriter, r *http.Request) {
		c, stop := context.WithTimeout(r.Context(), 2*time.Second)
		defer stop()
		if d.Ready == nil || d.Ready(c) != nil {
			fail(w, 503, "not_ready", "数据库不可用，请检查服务状态")
			return
		}
		writeJSON(w, 200, ReadyResponse{Status: "ready", Scope: "sqlite"})
	})
	routes.handle("GET /api/v1/version", "version", "", 200, nil, VersionResponse{}, func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, VersionResponse{Product: "Viorka", Version: Version, Stage: "m0"})
	})
	routes.handle("POST /api/v1/auth/login", "login", "", 200, LoginRequest{}, auth.Session{}, a.login)
	routes.handle("GET /api/v1/auth/session", "session", "viewer", 200, nil, auth.Session{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) { writeJSON(w, 200, s) }))
	routes.handle("POST /api/v1/auth/logout", "logout", "viewer", 204, nil, nil, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		c, _ := r.Cookie("viorka_session")
		if err := a.Auth.Logout(r.Context(), c.Value); err != nil {
			problem(w, err)
			return
		}
		a.cookie(w, "", -1)
		w.WriteHeader(204)
	}))
	routes.handle("POST /api/v1/nodes", "createNode", "admin", 201, EnrollmentRequest{}, auth.Enrollment{}, a.user("admin", a.enrollment))
	routes.handle("DELETE /api/v1/nodes/{id}/enrollment-token", "revokeEnrollment", "admin", 204, nil, nil, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		if err := a.Agents.RevokeEnrollment(r.Context(), s.User.ID, r.PathValue("id")); err != nil {
			problem(w, err)
			return
		}
		w.WriteHeader(204)
	}))
	routes.handle("POST /api/v1/agents/enroll", "enrollAgent", "", 201, EnrollRequest{}, EnrollResponse{}, a.enroll)
	routes.handle("POST /api/v1/agents/challenge", "agentChallenge", "", 200, ChallengeRequest{}, auth.Challenge{}, a.challenge)
	routes.handle("POST /api/v1/agents/session", "agentSession", "", 200, AgentSessionRequest{}, auth.AgentSession{}, a.agentSession)
	routes.handle("GET /api/v1/agents/ws", "agentWebSocket", "agent", 101, nil, nil, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery != "" || r.Header.Get("Origin") != "" {
			fail(w, 403, "forbidden", "Agent 接口不接受浏览器或查询参数")
			return
		}
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		node, expires, err := a.Agents.Authenticate(r.Context(), token)
		if err != nil {
			problem(w, err)
			return
		}
		a.Gateway.Serve(w, r, token, node, expires)
	})
	routes.handle("GET /api/v1/nodes", "listNodes", "viewer", 200, nil, NodesResponse{}, a.user("viewer", a.nodes))
	a.registerNodeSettings(routes)
	a.registerMetricHistory(routes)
	routes.handle("GET /api/v1/nodes/{id}/metrics", "nodeMetrics", "viewer", 200, nil, monitoring.Snapshot{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		n, err := a.Nodes.Node(r.Context(), r.PathValue("id"))
		if err != nil {
			problem(w, err)
			return
		}
		snapshot := a.Gateway.Metrics(n.ID, true)
		if n.State != "online" {
			snapshot.Stale = true
		}
		writeJSON(w, 200, snapshot)
	}))
	routes.handle("POST /api/v1/nodes/{id}/revoke", "revokeNode", "admin", 204, nil, nil, a.user("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		id := r.PathValue("id")
		if err := a.Agents.Revoke(r.Context(), s.User.ID, id); err != nil {
			problem(w, err)
			return
		}
		a.Gateway.Revoke(id)
		w.WriteHeader(204)
	}))
	routes.handle("POST /api/v1/nodes/{id}/tasks", "createTask", "operator", 202, TaskRequest{}, scheduler.Task{}, a.user("operator", a.createTask))
	routes.handle("GET /api/v1/tasks/{id}", "getTask", "viewer", 200, nil, scheduler.Task{}, a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		v, err := a.Tasks.Get(r.Context(), r.PathValue("id"))
		if err != nil {
			problem(w, err)
			return
		}
		writeJSON(w, 200, v)
	}))
	routes.handle("GET /api/v1/events", "events", "viewer", 200, nil, nil, a.user("viewer", a.events))
	m.HandleFunc("/api/", a.user("viewer", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		fail(w, 404, "not_found", "接口不存在")
	}))
	serveDocumentation(m, doc)
}

func secureHandler(m *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.Path != "/api/v1/events" && r.URL.Path != "/api/v1/agents/ws" {
			ctx, stop := context.WithTimeout(r.Context(), 10*time.Second)
			defer stop()
			r = r.WithContext(ctx)
			_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(10 * time.Second))
			_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(15 * time.Second))
		}
		m.ServeHTTP(w, r)
	})
}
func (a *api) cookie(w http.ResponseWriter, value string, age int) {
	http.SetCookie(w, &http.Cookie{Name: "viorka_session", Value: value, Path: "/", HttpOnly: true, Secure: strings.HasPrefix(a.Origin, "https://"), SameSite: http.SameSiteStrictMode, MaxAge: age})
}
func (a *api) user(role string, next func(http.ResponseWriter, *http.Request, auth.Session)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("viorka_session")
		if err != nil {
			problem(w, auth.ErrUnauthorized)
			return
		}
		s, err := a.Auth.Session(r.Context(), c.Value)
		if err != nil {
			problem(w, err)
			return
		}
		rank := map[string]int{"viewer": 1, "operator": 2, "admin": 3}
		if rank[s.User.Role] < rank[role] {
			fail(w, 403, "forbidden", "当前角色无权执行此操作")
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("Origin") != a.Origin || subtle.ConstantTimeCompare([]byte(r.Header.Get("X-CSRF-Token")), []byte(s.CSRF)) != 1 {
				fail(w, 403, "csrf_rejected", "会话校验失败，请刷新页面后重试")
				return
			}
		}
		next(w, r, s)
	}
}

// Global fixed-window limit keeps memory bounded, including when clients forge IPs.
func (a *api) allow(w http.ResponseWriter) bool {
	a.limitMu.Lock()
	defer a.limitMu.Unlock()
	if time.Since(a.limitStart) >= time.Minute {
		a.limitStart = time.Now()
		a.requests = 0
	}
	a.requests++
	if a.requests > 60 {
		w.Header().Set("Retry-After", "60")
		fail(w, 429, "rate_limited", "请求过于频繁，请稍后重试")
		return false
	}
	return true
}
func (a *api) login(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") != a.Origin {
		fail(w, 403, "origin_rejected", "请求来源不受信任")
		return
	}
	if !a.allow(w) {
		return
	}
	var v LoginRequest
	if !decode(w, r, &v) {
		return
	}
	if len(v.Username) < 1 || len(v.Username) > 64 || len(v.Password) < 1 || len(v.Password) > 72 {
		problem(w, auth.ErrInvalid)
		return
	}
	token, s, err := a.Auth.Login(r.Context(), v.Username, v.Password)
	if err != nil {
		problem(w, err)
		return
	}
	a.cookie(w, token, 43200)
	writeJSON(w, 200, s)
}
func (a *api) enrollment(w http.ResponseWriter, r *http.Request, s auth.Session) {
	var v EnrollmentRequest
	if !decode(w, r, &v) {
		return
	}
	e, err := a.Agents.CreateEnrollment(r.Context(), s.User.ID, strings.TrimSpace(v.Name), v.Kind)
	if err != nil {
		problem(w, err)
		return
	}
	writeJSON(w, 201, e)
}
func (a *api) enroll(w http.ResponseWriter, r *http.Request) {
	if !a.allow(w) {
		return
	}
	var v EnrollRequest
	if !decode(w, r, &v) {
		return
	}
	id, err := a.Agents.Enroll(r.Context(), v.Token, v.PublicKey, v.ProtocolVersion)
	if err != nil {
		problem(w, err)
		return
	}
	writeJSON(w, 201, EnrollResponse{NodeID: id, ProtocolVersion: "1.0"})
}
func (a *api) challenge(w http.ResponseWriter, r *http.Request) {
	if !a.allow(w) {
		return
	}
	var v ChallengeRequest
	if !decode(w, r, &v) {
		return
	}
	c, err := a.Agents.Challenge(r.Context(), v.NodeID)
	if err != nil {
		problem(w, err)
		return
	}
	writeJSON(w, 200, c)
}
func (a *api) agentSession(w http.ResponseWriter, r *http.Request) {
	if !a.allow(w) {
		return
	}
	var v AgentSessionRequest
	if !decode(w, r, &v) {
		return
	}
	s, err := a.Agents.Session(r.Context(), v.ChallengeID, v.Signature)
	if err != nil {
		problem(w, err)
		return
	}
	writeJSON(w, 200, s)
}
func (a *api) nodes(w http.ResponseWriter, r *http.Request, s auth.Session) {
	limit := 50
	var err error
	if r.URL.Query().Get("limit") != "" {
		limit, err = strconv.Atoi(r.URL.Query().Get("limit"))
	}
	after := r.URL.Query().Get("after")
	if err != nil || limit < 1 || limit > 100 || len(after) > 128 {
		problem(w, auth.ErrInvalid)
		return
	}
	items, err := a.Nodes.Nodes(r.Context(), limit, after)
	if err != nil {
		problem(w, err)
		return
	}
	for i := range items {
		snapshot := a.Gateway.Metrics(items[i].ID, false)
		if items[i].State != "online" {
			snapshot.Stale = true
		}
		items[i].Monitoring = &snapshot
	}
	writeJSON(w, 200, NodesResponse{Items: items})
}
func (a *api) createTask(w http.ResponseWriter, r *http.Request, s auth.Session) {
	var v TaskRequest
	if !decode(w, r, &v) {
		return
	}
	t, err := a.Tasks.Create(r.Context(), s.User.ID, r.PathValue("id"), v.Operation, v.IdempotencyKey)
	if err != nil {
		problem(w, err)
		return
	}
	writeJSON(w, 202, t)
}
func (a *api) events(w http.ResponseWriter, r *http.Request, s auth.Session) {
	select {
	case a.streams <- struct{}{}:
		defer func() { <-a.streams }()
	default:
		fail(w, 429, "stream_limit", "连接过多，请关闭多余页面")
		return
	}
	if a.Settings != nil {
		v, e := a.Settings.Get(r.Context())
		if e != nil {
			problem(w, e)
			return
		}
		if !v.SSE {
			fail(w, 409, "events_disabled", "实时推送已关闭")
			return
		}
	}
	cookie, _ := r.Cookie("viorka_session")
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	rc := http.NewResponseController(w)
	tick := time.NewTicker(3 * time.Second)
	defer tick.Stop()
	for {
		if _, err := a.Auth.Session(r.Context(), cookie.Value); err != nil {
			return
		}
		if a.Settings != nil {
			v, e := a.Settings.Get(r.Context())
			if e != nil || !v.SSE {
				return
			}
		}
		if rc.SetWriteDeadline(time.Now().Add(5*time.Second)) != nil {
			return
		}
		payload := []byte("{}")
		if a.Settings != nil {
			items, e := a.Settings.Notifications(r.Context())
			if e != nil {
				return
			}
			payload, _ = json.Marshal(NotificationsResponse{items})
		}
		if _, err := io.WriteString(w, "event: snapshot\ndata: "+string(payload)+"\n\n"); err != nil {
			return
		}
		if rc.Flush() != nil {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-a.Shutdown.Done():
			return
		case <-tick.C:
		}
	}
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	kind, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || kind != "application/json" {
		fail(w, 415, "content_type", "请使用 application/json")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 16384)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	err = d.Decode(v)
	if err == nil {
		var extra any
		if d.Decode(&extra) != io.EOF {
			err = auth.ErrInvalid
		}
	}
	if err != nil {
		var large *http.MaxBytesError
		if errors.As(err, &large) {
			fail(w, 413, "body_too_large", "请求内容过大")
		} else {
			problem(w, auth.ErrInvalid)
		}
		return false
	}
	return true
}
func problem(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrUnauthorized):
		fail(w, 401, "unauthorized", "凭证无效或会话已过期，请重新登录或检查节点身份")
	case errors.Is(err, auth.ErrInvalid):
		fail(w, 400, "invalid_request", "参数无效，请检查字段和取值")
	case errors.Is(err, auth.ErrConflict):
		fail(w, 409, "conflict", "资源状态冲突，请刷新后重试")
	case errors.Is(err, auth.ErrNotFound):
		fail(w, 404, "not_found", "资源不存在")
	default:
		fail(w, 503, "unavailable", "服务暂不可用，请稍后重试")
	}
}
func fail(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, ErrorResponse{Code: code, Message: message})
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
