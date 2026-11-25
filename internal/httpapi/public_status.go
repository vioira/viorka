package httpapi

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/platform/exchange"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/realtime"
	v1 "github.com/vioira/viorka/protocol/v1"
)

type statusRepository interface {
	exchange.Repository
	StatusVersion(context.Context) (int64, int64, bool, error)
	StatusPublication(context.Context) (inventory.StatusPublication, error)
	SaveStatusPublication(context.Context, string, inventory.StatusPublication) error
	CategoryCatalog(context.Context) (inventory.CategoryCatalog, error)
	SaveCategories(context.Context, string, inventory.CategoryCatalog) error
	AssignCategories(context.Context, string, inventory.CategoryAssignment) error
	StatusLifetime(context.Context, string, time.Time) (*inventory.TrafficLifetime, error)
	TelemetrySettings(context.Context, string) (v1.TelemetrySettings, error)
}
type StatusPage struct {
	At    time.Time               `json:"at"`
	Nodes []StatusNode            `json:"nodes"`
	Rates inventory.ExchangeRates `json:"rates"`
	Live  bool                    `json:"live"`
}
type statusCache struct {
	build             chan struct{}
	readers           chan struct{}
	version, category int64
	page              *StatusPage
	fx                exchange.Cache
	streams           chan struct{}
	historySlots      chan struct{}
}

func (a *api) registerPublicStatus(routes routeRegistry) {
	repo, _ := a.Nodes.(statusRepository)
	guard := func(handler http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if repo == nil {
				problem(w, proxy.ErrUnavailable)
				return
			}
			handler(w, r)
		}
	}
	session := func(role string, handler func(http.ResponseWriter, *http.Request, auth.Session)) http.HandlerFunc {
		return a.user(role, func(w http.ResponseWriter, r *http.Request, s auth.Session) {
			if repo == nil {
				problem(w, proxy.ErrUnavailable)
				return
			}
			handler(w, r, s)
		})
	}
	routes.handle("GET /api/v1/node-categories", "nodeCategories", "viewer", 200, nil, inventory.CategoryCatalog{}, session("viewer", func(w http.ResponseWriter, r *http.Request, _ auth.Session) {
		v, e := repo.CategoryCatalog(r.Context())
		statusResult(w, v, e)
	}))
	routes.handle("PUT /api/v1/node-categories", "saveNodeCategories", "admin", 204, inventory.CategoryCatalog{}, nil, session("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var c inventory.CategoryCatalog
		if decodeLimit(w, r, &c, 131072) {
			statusSaved(w, repo.SaveCategories(r.Context(), s.User.ID, c))
		}
	}))
	routes.handle("PATCH /api/v1/node-categories/members", "assignNodeCategories", "admin", 204, inventory.CategoryAssignment{}, nil, session("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var v inventory.CategoryAssignment
		if decodeLimit(w, r, &v, 32768) {
			statusSaved(w, repo.AssignCategories(r.Context(), s.User.ID, v))
		}
	}))
	routes.handle("GET /api/v1/settings/status-page", "getStatusPublication", "admin", 200, nil, inventory.StatusPublication{}, session("admin", func(w http.ResponseWriter, r *http.Request, _ auth.Session) {
		v, e := repo.StatusPublication(r.Context())
		statusResult(w, v, e)
	}))
	routes.handle("PUT /api/v1/settings/status-page", "publishStatusPage", "admin", 204, inventory.StatusPublication{}, nil, session("admin", func(w http.ResponseWriter, r *http.Request, s auth.Session) {
		var p inventory.StatusPublication
		if decodeLimit(w, r, &p, 131072) {
			statusSaved(w, repo.SaveStatusPublication(r.Context(), s.User.ID, p))
		}
	}))
	routes.handle("POST /api/v1/settings/status-page/preview", "previewStatusPage", "admin", 200, inventory.StatusPublication{}, StatusPage{}, session("admin", func(w http.ResponseWriter, r *http.Request, _ auth.Session) {
		var p inventory.StatusPublication
		if !decodeLimit(w, r, &p, 131072) {
			return
		}
		if err := p.Validate(); err != nil {
			problem(w, err)
			return
		}
		v, e := a.buildStatusPage(r.Context(), repo, p)
		statusResult(w, v, e)
	}))
	routes.handle("GET /api/v1/status", "publicStatus", "", 200, nil, StatusPage{}, guard(func(w http.ResponseWriter, r *http.Request) {
		select {
		case a.status.readers <- struct{}{}:
			defer func() { <-a.status.readers }()
		default:
			fail(w, 429, "snapshot_limit", "状态查询繁忙，请稍后重试")
			return
		}
		v, e := a.readStatusPage(r.Context(), repo)
		statusResult(w, v, e)
	}))
	routes.handle("GET /api/v1/status/events", "publicStatusEvents", "", 200, nil, nil, guard(func(w http.ResponseWriter, r *http.Request) { a.statusEvents(w, r, repo) }))
	routes.handle("GET /api/v1/status/nodes/{id}/history", "publicStatusHistory", "", 200, nil, StatusHistory{}, guard(func(w http.ResponseWriter, r *http.Request) { a.statusHistory(w, r, repo) }))
}
func statusSaved(w http.ResponseWriter, err error) {
	if err != nil {
		problem(w, err)
		return
	}
	w.WriteHeader(204)
}
func statusResult(w http.ResponseWriter, v any, err error) {
	if err != nil {
		problem(w, err)
		return
	}
	writeJSON(w, 200, v)
}
func (a *api) buildStatusPage(ctx context.Context, repo statusRepository, p inventory.StatusPublication) (*StatusPage, error) {
	out := &StatusPage{At: time.Now().UTC(), Nodes: []StatusNode{}}
	if a.Settings != nil {
		settings, err := a.Settings.Get(ctx)
		if err != nil {
			return nil, err
		}
		out.Live = settings.SSE
	}
	needRates := false
	for _, entry := range p.Nodes {
		n, err := a.statusNode(ctx, repo, entry, out.At)
		if err != nil {
			return nil, err
		}
		out.Nodes = append(out.Nodes, n)
		needRates = needRates || n.Price != nil && n.Currency != "CNY"
	}
	if needRates {
		rates, err := a.status.fx.Rates(ctx, repo, out.At)
		if err != nil {
			return nil, err
		}
		out.Rates = rates
	}
	return out, nil
}
func (a *api) readStatusPage(ctx context.Context, repo statusRepository) (*StatusPage, error) {
	select {
	case a.status.build <- struct{}{}:
		defer func() { <-a.status.build }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	rev, cat, on, err := repo.StatusVersion(ctx)
	if err != nil {
		return nil, err
	}
	if !on {
		return nil, auth.ErrNotFound
	}
	if cached := a.status.page; cached != nil && a.status.version == rev && a.status.category == cat && time.Since(cached.At) < 5*time.Second {
		return cached, nil
	}
	p, err := repo.StatusPublication(ctx)
	if err != nil {
		return nil, err
	}
	if !p.Enabled {
		return nil, auth.ErrNotFound
	}
	page, err := a.buildStatusPage(ctx, repo, p)
	if err != nil {
		return nil, err
	}
	latest, classes, enabled, err := repo.StatusVersion(ctx)
	if err != nil {
		return nil, err
	}
	if !enabled {
		return nil, auth.ErrNotFound
	}
	if latest != p.Revision || classes != cat {
		return nil, auth.ErrConflict
	}
	a.status.page, a.status.version, a.status.category = page, latest, classes
	return page, nil
}
func (a *api) statusEvents(w http.ResponseWriter, r *http.Request, repo statusRepository) {
	select {
	case a.status.streams <- struct{}{}:
		defer func() { <-a.status.streams }()
	default:
		fail(w, 429, "stream_limit", "连接过多，请稍后重试")
		return
	}
	sub := a.Events.Subscribe(func(c realtime.Change) bool {
		return c.Kind == "public_status" || c.Kind == "nodes" || c.Kind == "settings"
	})
	defer sub.Close()
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	for {
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		v, err := a.readStatusPage(ctx, repo)
		cancel()
		if errors.Is(err, auth.ErrNotFound) {
			streamFrame(w, "event: withdrawn\ndata: {}\n\n")
			return
		}
		if err != nil || !streamJSON(w, "snapshot", v) {
			return
		}
		if !v.Live {
			return
		}
		select {
		case <-r.Context().Done():
			return
		case <-a.Shutdown.Done():
			return
		case <-ticker.C:
		case <-sub.Wake:
			sub.Drain()
		}
	}
}

type StatusHistory struct {
	Charts monitoring.MetricTrends `json:"charts"`
	Lines  []StatusLine            `json:"lines"`
	Start  time.Time               `json:"start"`
	End    time.Time               `json:"end"`
	Period int                     `json:"probe_period"`
}

func (a *api) statusHistory(w http.ResponseWriter, r *http.Request, repo statusRepository) {
	select {
	case a.status.historySlots <- struct{}{}:
		defer func() { <-a.status.historySlots }()
	default:
		fail(w, 429, "history_limit", "历史查询繁忙，请稍后重试")
		return
	}
	ctx := r.Context()
	p, err := repo.StatusPublication(ctx)
	if err != nil {
		problem(w, err)
		return
	}
	id := r.PathValue("id")
	public := false
	for _, n := range p.Nodes {
		if n.ID == id {
			public = p.Enabled
			break
		}
	}
	if !public {
		problem(w, auth.ErrNotFound)
		return
	}
	duration, period, probe := time.Hour, 30, 60
	for key, values := range r.URL.Query() {
		if key != "range" || len(values) != 1 {
			problem(w, auth.ErrInvalid)
			return
		}
	}
	switch r.URL.Query().Get("range") {
	case "", "1h":
	case "6h":
		duration, period, probe = 6*time.Hour, 180, 300
	case "24h":
		duration, period, probe = 24*time.Hour, 720, 900
	case "2d":
		duration, period, probe = 48*time.Hour, 1440, 900
	case "7d":
		duration, period, probe = 168*time.Hour, 5040, 3600
	default:
		problem(w, auth.ErrInvalid)
		return
	}
	if a.History == nil || a.TCPHistory == nil {
		problem(w, proxy.ErrUnavailable)
		return
	}
	now := time.Now().UTC()
	end := time.Unix(now.Unix()/int64(period)*int64(period), 0).UTC()
	start := end.Add(-duration)
	buckets, err := a.History.MetricHistory(ctx, id, start, end, period)
	if err != nil {
		problem(w, err)
		return
	}
	_, charts := monitoring.NewMetricTrendWindows(buckets, start, end)
	history, err := a.TCPHistory.TCPProbeHistory(ctx, id, "", now.Add(-duration), now, now, probe)
	if err != nil {
		problem(w, err)
		return
	}
	cfg, err := repo.TelemetrySettings(ctx, id)
	if err != nil {
		problem(w, err)
		return
	}
	rev, _, enabled, err := repo.StatusVersion(ctx)
	if err != nil {
		problem(w, err)
		return
	}
	if !enabled || rev != p.Revision {
		problem(w, auth.ErrNotFound)
		return
	}
	writeJSON(w, 200, StatusHistory{charts, statusLines(cfg.TcpProbe, history, nil), now.Add(-duration), now, probe})
}
