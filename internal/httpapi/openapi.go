package httpapi

import (
	"encoding/json"
	"net/http"
	"reflect"
	"strconv"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func newOpenAPI() *huma.OpenAPI {
	return &huma.OpenAPI{OpenAPI: "3.1.0", Info: &huma.Info{Title: "Viorka M0 API", Version: Version,
		Description: "Generated from Go route registrations and transport types. All roles are installation-wide. JSON requests reject unknown fields and are limited to 16384 bytes unless the operation declares a different limit. String length limits described in bytes are enforced by the application. Credentials must never be placed in URLs."},
		Components: &huma.Components{Schemas: huma.NewMapRegistry("#/components/schemas/", huma.DefaultSchemaNamer), SecuritySchemes: map[string]*huma.SecurityScheme{
			"cookieAuth":  {Type: "apiKey", In: "cookie", Name: "viorka_session"},
			"agentBearer": {Type: "http", Scheme: "bearer", Description: "Short-lived Agent session token"},
		}}}
}

// OpenAPIDocument builds the same route registry as the server, without opening
// a database, bootstrapping identities, or invoking any handler.
func OpenAPIDocument() *huma.OpenAPI {
	doc := newOpenAPI()
	registerRoutes(&api{}, http.NewServeMux(), doc)
	return doc
}

type routeRegistry struct {
	mux *http.ServeMux
	doc *huma.OpenAPI
}

// handle is the single registration point for both the live route and its
// contract. Huma supplies schemas; existing handlers retain wire validation,
// authorization and streaming behavior instead of adopting framework defaults.
func (r routeRegistry) handle(pattern, id, role string, status int, input, output any, handler http.HandlerFunc) {
	method, path, _ := strings.Cut(pattern, " ")
	op := &huma.Operation{Method: method, Path: path, OperationID: id, Summary: operationSummary(id), Responses: map[string]*huma.Response{}}
	schema := func(value any) *huma.Schema { return r.doc.Components.Schemas.Schema(reflect.TypeOf(value), true, "") }
	if input != nil {
		op.RequestBody = &huma.RequestBody{Required: true, Content: map[string]*huma.MediaType{"application/json": {Schema: schema(input)}}}
	}
	response := &huma.Response{Description: http.StatusText(status)}
	if output != nil {
		response.Content = map[string]*huma.MediaType{"application/json": {Schema: schema(output)}}
	}
	op.Responses[strconv.Itoa(status)] = response
	if strings.Contains(path, "{id}") {
		op.Parameters = append(op.Parameters, &huma.Param{Name: "id", In: "path", Required: true, Schema: &huma.Schema{Type: "string"}})
	}
	errors := []int{}
	if role == "agent" {
		op.Security = []map[string][]string{{"agentBearer": {}}}
		errors = append(errors, 401, 403, 503)
	} else if role != "" {
		op.Security = []map[string][]string{{"cookieAuth": {}}}
		op.Description = "Minimum role: " + role + ". "
		errors = append(errors, 401, 403, 503)
		if method != http.MethodGet {
			op.Parameters = append(op.Parameters, &huma.Param{Name: "X-CSRF-Token", In: "header", Required: true, Schema: &huma.Schema{Type: "string"}})
		}
	}
	if (role != "" && role != "agent" && method != http.MethodGet) || id == "login" || id == "acceptInvitation" {
		op.Parameters = append(op.Parameters, &huma.Param{Name: "Origin", In: "header", Required: true, Description: "Must exactly match the active public origin or an entry in VIORKA_ALLOWED_ORIGINS", Schema: &huma.Schema{Type: "string"}})
	}
	if input != nil {
		errors = append(errors, 400, 413, 415)
	}
	switch id {
	case "listTasks":
		errors = append(errors, 400)
		min, max, length := float64(1), float64(100), 128
		op.Parameters = append(op.Parameters,
			&huma.Param{Name: "limit", In: "query", Schema: &huma.Schema{Type: "integer", Default: 50, Minimum: &min, Maximum: &max}},
			&huma.Param{Name: "after", In: "query", Schema: &huma.Schema{Type: "string", MaxLength: &length}},
			&huma.Param{Name: "state", In: "query", Schema: &huma.Schema{Type: "string", Default: "all", Enum: []any{"all", "queued", "dispatched", "accepted", "running", "succeeded", "failed", "cancelled", "rolled_back"}}})
		op.Description += "Instance-wide tasks, newest first by created_at and ID descending. Use next_cursor as after; empty means no next page. Unknown cursors, unknown/repeated query parameters and invalid filters return 400."
	case "taskSummary":
		errors = append(errors, 400)
		op.Description += "Counts tasks created within the returned UTC 24-hour window. Retries count as one task. success_rate is succeeded/(succeeded+failed)*100, null without completed outcomes. active counts all queued/dispatched/accepted/running tasks regardless of creation time. Rejects query parameters."
	case "saveSettings", "inviteUser", "removeUser", "changeUserRole", "createBackup", "restoreBackup", "cancelRestore":
		errors = append(errors, 400, 404, 409, 429)
	case "changePassword":
		errors = append(errors, 400, 409, 429)
	case "acceptInvitation":
		errors = append(errors, 401, 403, 409, 429, 503)

	case "ready":
		errors = append(errors, 503)
	case "login":
		errors = append(errors, 401, 403, 429, 503)
		op.Description += "Creates a 12-hour session, replacing the user's previous session. Returns an HttpOnly viorka_session cookie."
		response.Headers = map[string]*huma.Param{"Set-Cookie": {Schema: &huma.Schema{Type: "string"}, Description: "viorka_session; HttpOnly; SameSite=Strict; Secure on HTTPS"}}
	case "resetEnrollment":
		errors = append(errors, 400, 404, 409)
		op.Description += "Explicitly resets a disconnected node for registration, revoking credentials, sessions and challenges. Preserves node ID, configuration, metrics, tasks and audit history. Rejects online/connecting nodes and unfinished tasks with 409 reenrollment_conflict. Returns a single-use 15-minute token. Records node.enrollment.reset atomically."
	case "renewEnrollment":
		errors = append(errors, 400, 404, 409)
		op.Description += "Replaces the unused enrollment token for an existing pending node. The new single-use token expires after 15 minutes; old tokens immediately stop working. Records node.enrollment.renew atomically. Returns 409 for registered or disabled nodes and 404 for missing nodes. Plaintext is returned only in this response."
	case "createNode":
		op.Description += "Atomically creates a pending node and its single-use token valid for 15 minutes; the returned id is the node ID and the token is returned only once."
	case "enrollAgent":
		errors = append(errors, 401, 409, 429, 503)
		op.Description = "Binds the existing node identified by the token to an Ed25519 identity without creating another node. Same token and public key may retry before expiry; a different key cannot reuse it."
	case "agentChallenge":
		errors = append(errors, 401, 429, 503)
		op.Description = "Creates a one-minute challenge bound to the node and Panel origin."
	case "getTelemetrySettings", "getTelemetrySettingsStatus", "saveTelemetrySettings":
		errors = append(errors, 400, 404)
		if id == "saveTelemetrySettings" {
			errors = append(errors, 409)
		}
		op.Description += "Telemetry v3 desired settings and revision space. Retired Agent settings endpoints are not available. C=1..60 (default 30), R=30..180 (default 60), W=1..5 (default 2). C and R are independent, including C>R. PUT requires the current revision and returns the incremented revision; application remains pending until the Agent confirms. Saving does not enable v3 capability. History uses fixed 30-second buckets. Query parameters are rejected."
	case "agentMetrics":
		errors = append(errors, 409, 429)
		op.Description = "Telemetry v3: maximum 1048576-byte uncompressed application/json body, no query, Origin or Cookie. Requires bearer authentication and completed v3 negotiation; management WSS may be offline. Receipt acknowledges in-memory admission, not durable storage. 401 distinguishes session_expired from permanent session_invalid/identity_revoked/node_disabled. 409 means unsupported_protocol or stale_session. 429 rate_limited and 503 overloaded include Retry-After seconds. Rejections with a decoded batch ID return TelemetryReceipt; other failures return the standard error object. Strict validation follows api/agent/v1/envelope.schema.json TelemetryBatch, including cross-field rules."
	case "agentSession":
		errors = append(errors, 401, 429, 503)
		op.Description = "Consumes a challenge once and returns a 15-minute bearer token."
	case "revokeEnrollment", "revokeNode", "getTask", "nodeMetrics":
		errors = append(errors, 404)
	case "getNode":
		errors = append(errors, 400, 404)
		op.Description += "Returns persisted node inventory and the latest monitoring summary. Offline metrics are marked stale. No credentials or complete configuration are returned."
	case "deleteNode":
		errors = append(errors, 400, 404, 409)
		op.Description += "Permanently removes Panel node records, enrollment token, Agent credentials/sessions/challenges, addresses, port records, terminal tasks, notifications and metric history. Preserves audit records and records node.delete atomically. Disconnects the management session; does not uninstall Agent or modify services on the host. Returns 409 node_tasks_active for unfinished tasks, or node_in_use for engines, services, relay references, revisions or deployments. Missing nodes return 404."
	case "nodeMetricHistory":
		errors = append(errors, 400, 404, 503)
		op.Parameters = append(op.Parameters, &huma.Param{Name: "range", In: "query", Schema: &huma.Schema{Type: "string", Enum: []any{"1h", "6h", "24h", "2d", "7d"}, Default: "1h"}})
		op.Description = "Typed history from fixed 30-second buckets over at most 168 hours. CPU/RAM-used/Swap-used retain independent sums and counts; rate/socket/device peaks retain maxima and counts; capacity/counters/load retain their original observation times. Missing values are null; slow-only buckets do not invent fast samples. Large byte counters are decimal strings. Complete base buckets beginning within the requested range are merged without interpolation. Resolution: 30 seconds for 1h, 180 for 6h, 720 for 24h, 1440 for 2d, 3600 for 7d. Maximum 169 points."
	case "createTask":
		errors = append(errors, 404, 409)
		op.Description += "Persists node.inspect and returns 202. Acceptance is not execution success; inspect the task state for its outcome."
	case "listAuditLogs":
		errors = append(errors, 400)
		min, max, length := float64(1), float64(100), 128
		op.Parameters = append(op.Parameters,
			&huma.Param{Name: "limit", In: "query", Schema: &huma.Schema{Type: "integer", Default: 50, Minimum: &min, Maximum: &max}},
			&huma.Param{Name: "after", In: "query", Schema: &huma.Schema{Type: "string", MaxLength: &length}},
			&huma.Param{Name: "kind", In: "query", Schema: &huma.Schema{Type: "string", Default: "all", Enum: []any{"all", "user", "system"}}})
		op.Description += "Newest first by created_at and ID descending. Use next_cursor as after; empty means no next page. System records have no actor_id. Unknown cursors return 400. Does not expose summary_json."
	case "listNodes", "listUsers", "listNodeTasks":
		if id == "listNodeTasks" {
			errors = append(errors, 404)
			op.Description += "Newest first by creation time and ID descending. after is an exclusive task ID belonging to this node; unknown or cross-node cursors return 400."
		}
		errors = append(errors, 400)
		min, max, length := float64(1), float64(100), 128
		op.Parameters = append(op.Parameters,
			&huma.Param{Name: "limit", In: "query", Schema: &huma.Schema{Type: "integer", Default: 50, Minimum: &min, Maximum: &max}},
			&huma.Param{Name: "after", In: "query", Description: "Exclusive resource ID cursor; node/user lists use ascending ID order, node tasks use descending creation time and ID", Schema: &huma.Schema{Type: "string", MaxLength: &length}})
	case "agentWebSocket":
		op.Description = "WebSocket upgrade authenticated with an Agent bearer token. Browser Origin and all query parameters are rejected. Agent message schemas are maintained separately under api/agent/v1; this document describes only the HTTP handshake."
	case "metricEvents":
		errors = append(errors, 400, 404, 409, 429)
		response.Content = map[string]*huma.MediaType{"text/event-stream": {Schema: &huma.Schema{Type: "string"}}}
		op.Parameters = append(op.Parameters, &huma.Param{Name: "node", In: "query", Description: "One node ID for complete metrics and up to 600 points from the last ten minutes. Exactly one of node/through is required.", Schema: &huma.Schema{Type: "string"}}, &huma.Param{Name: "through", In: "query", Description: "Inclusive ascending node ID range from the start of the list, at most 1024 nodes. Sends CPU/memory summaries without sample windows.", Schema: &huma.Schema{Type: "string"}})
		op.Description += "SSE metrics events contain MetricFrame: reset, items keyed by node ID, removed_ids. Each item is a LiveSnapshot with latest metrics, sequence, reset and points. Per-node sequences order accepted samples. Initial/reconnect snapshots restore up to 600 raw in-memory samples over ten minutes; subsequent frames append raw samples with the same bounds. Timestamps identify actual sample times. Overflow forces a fresh snapshot. closed ends a disabled/expired stream. No Last-Event-ID replay. Cookie viewer authorization is installation-wide, matching node REST access. Authorized node membership owns shared telemetry v3 viewer references. The last viewer starts a 15-second grace; active demand is renewed every 30 seconds with a 90-second Agent lease. References and initial snapshots do not mean the Agent has acknowledged realtime mode. A negotiated v3 item exposes telemetry (independent fast/full/public_ip groups, decimal-string integer counters, sampled/received timestamps, stale flags, applied settings and raw fast points) and telemetry_control (http/pending/realtime/degraded, viewer references, lease remainder). management_online is independent of metrics freshness: offline management does not invalidate fresh POST data. Samples use the nested telemetry window; outer history/points are empty. Duplicate uploads refresh only overall receipt time, not group times or points. REST history and the general events stream do not acquire this demand."
	case "events":
		errors = append(errors, 429, 409)
		response.Content = map[string]*huma.MediaType{"text/event-stream": {Schema: &huma.Schema{Type: "string"}}}
		op.Description += "SSE sends an initial notification snapshot {items}, then ready. Durable changes trigger notifications {items, removed_ids} or change {kind, node_id?, node?}. Kinds: node (current node metadata), nodes (membership invalidation), tasks, history, telemetry_settings, telemetry_settings_result, settings. Subscribe before loading REST snapshots; ready on reconnect/overflow requires resynchronization. No Last-Event-ID replay; latest 100 notifications retained. Comment heartbeats every 15 seconds only revalidate access/settings, never poll business data. closed ends disabled or invalid-session streams. Each write has a five-second deadline; streams and pending changes are bounded."
	}
	for _, code := range errors {
		op.Responses[strconv.Itoa(code)] = &huma.Response{Description: http.StatusText(code), Content: map[string]*huma.MediaType{"application/json": {Schema: schema(ErrorResponse{})}}}
	}
	if id == "agentMetrics" {
		for _, code := range []string{"400", "409", "429", "503"} {
			op.Responses[code].Content["application/json"].Schema = &huma.Schema{OneOf: []*huma.Schema{schema(ErrorResponse{}), schema(v1.TelemetryReceipt{})}}
		}
		for _, code := range []string{"429", "503"} {
			op.Responses[code].Headers = map[string]*huma.Param{"Retry-After": {Schema: &huma.Schema{Type: "string"}, Description: "Minimum retry delay in seconds for rate_limited/overloaded"}}
		}
	}

	r.doc.AddOperation(op)
	r.mux.HandleFunc(pattern, handler)
}

func operationSummary(id string) string {
	return map[string]string{
		"metricEvents": "Subscribe to scoped live node metrics",
		"listTasks":    "List instance tasks", "taskSummary": "Get task center summary",
		"getSettings": "Get panel settings", "saveSettings": "Save panel settings (Origin applies on restart)", "changePassword": "Change own password", "logoutAll": "Revoke all own sessions", "listUsers": "List users and active invitations", "inviteUser": "Create one-time invitation (24 hours)", "acceptInvitation": "Accept an invitation", "removeUser": "Disable user or revoke invitation", "changeUserRole": "Change user role and revoke sessions", "listBackups": "List encrypted backups", "createBackup": "Create encrypted SQLite snapshot", "restoreBackup": "Validate and schedule restore on restart", "cancelRestore": "Cancel pending restore", "listNotifications": "List latest offline notifications",
		"listAuditLogs": "List audit logs (admin only)", "health": "Process liveness", "ready": "SQLite readiness", "version": "Product version",
		"login": "Log in", "session": "Get current session", "logout": "Log out",
		"resetEnrollment": "Reset node identity while preserving history",
		"renewEnrollment": "Renew pending node enrollment token",
		"createNode":      "Create pending node and one-time enrollment token", "revokeEnrollment": "Revoke enrollment token",
		"enrollAgent": "Enroll Agent", "agentChallenge": "Create Agent challenge", "agentSession": "Create Agent session",
		"agentWebSocket": "Connect Agent WebSocket", "listNodes": "List nodes", "getNode": "Get node details", "deleteNode": "Delete node", "revokeNode": "Revoke node identity",
		"createTask": "Submit node task", "getTask": "Get task", "listNodeTasks": "List tasks for a node", "events": "Subscribe to server events",
	}[id]
}

func serveDocumentation(mux *http.ServeMux, doc *huma.OpenAPI) {
	mux.HandleFunc("GET /openapi.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(doc)
	})
	mux.HandleFunc("GET /openapi.yaml", func(w http.ResponseWriter, r *http.Request) {
		b, err := doc.YAML()
		if err != nil {
			problem(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/yaml; charset=utf-8")
		_, _ = w.Write(b)
	})
	mux.HandleFunc("GET /docs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Viorka API</title></head><body><redoc spec-url="/openapi.json"></redoc><noscript>JavaScript is required. <a href="/openapi.yaml">Download OpenAPI</a></noscript><script src="https://cdn.redoc.ly/redoc/v2.5.0/bundles/redoc.standalone.js"></script></body></html>`))
	})
}
