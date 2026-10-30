package httpapi

import (
	"encoding/json"
	"net/http"
	"reflect"
	"strconv"
	"strings"

	"github.com/danielgtaylor/huma/v2"
)

func newOpenAPI() *huma.OpenAPI {
	return &huma.OpenAPI{OpenAPI: "3.1.0", Info: &huma.Info{Title: "Viorka M0 API", Version: Version,
		Description: "Generated from Go route registrations and transport types. All roles are installation-wide. JSON requests reject unknown fields and are limited to 16384 bytes. String length limits described in bytes are enforced by the application. Credentials must never be placed in URLs."},
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
		op.Parameters = append(op.Parameters, &huma.Param{Name: "Origin", In: "header", Required: true, Description: "Must exactly match the configured VIORKA_ORIGIN", Schema: &huma.Schema{Type: "string"}})
	}
	if input != nil {
		errors = append(errors, 400, 413, 415)
	}
	switch id {
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
	case "createNode":
		op.Description += "Atomically creates a pending node and its single-use token valid for 15 minutes; the returned id is the node ID and the token is returned only once."
	case "enrollAgent":
		errors = append(errors, 401, 409, 429, 503)
		op.Description = "Binds the existing node identified by the token to an Ed25519 identity without creating another node. Same token and public key may retry before expiry; a different key cannot reuse it."
	case "agentChallenge":
		errors = append(errors, 401, 429, 503)
		op.Description = "Creates a one-minute challenge bound to the node and Panel origin."
	case "agentSession":
		errors = append(errors, 401, 429, 503)
		op.Description = "Consumes a challenge once and returns a 15-minute bearer token."
	case "revokeEnrollment", "revokeNode", "getTask", "nodeMetrics":
		errors = append(errors, 404)
	case "createTask":
		errors = append(errors, 404, 409)
		op.Description += "Persists node.inspect and returns 202. Acceptance is not execution success; inspect the task state for its outcome."
	case "listNodes", "listUsers":
		errors = append(errors, 400)
		min, max, length := float64(1), float64(100), 128
		op.Parameters = append(op.Parameters,
			&huma.Param{Name: "limit", In: "query", Schema: &huma.Schema{Type: "integer", Default: 50, Minimum: &min, Maximum: &max}},
			&huma.Param{Name: "after", In: "query", Description: "Exclusive node ID cursor; ascending ID order", Schema: &huma.Schema{Type: "string", MaxLength: &length}})
	case "agentWebSocket":
		op.Description = "WebSocket upgrade authenticated with an Agent bearer token. Browser Origin and all query parameters are rejected. Agent message schemas are maintained separately under api/agent/v1; this document describes only the HTTP handshake."
	case "events":
		errors = append(errors, 429, 409)
		response.Content = map[string]*huma.MediaType{"text/event-stream": {Schema: &huma.Schema{Type: "string"}}}
		op.Description += "SSE emits bounded offline notifications in event: snapshot every 3 seconds. Disabling SSE rejects new streams (409) and closes existing ones. Session rechecked on each iteration; connection count is bounded."
	}
	for _, code := range errors {
		op.Responses[strconv.Itoa(code)] = &huma.Response{Description: http.StatusText(code), Content: map[string]*huma.MediaType{"application/json": {Schema: schema(ErrorResponse{})}}}
	}
	r.doc.AddOperation(op)
	r.mux.HandleFunc(pattern, handler)
}

func operationSummary(id string) string {
	return map[string]string{
		"getSettings": "Get panel settings", "saveSettings": "Save panel settings (Origin applies on restart)", "changePassword": "Change own password", "logoutAll": "Revoke all own sessions", "listUsers": "List users and active invitations", "inviteUser": "Create one-time invitation (24 hours)", "acceptInvitation": "Accept an invitation", "removeUser": "Disable user or revoke invitation", "changeUserRole": "Change user role and revoke sessions", "listBackups": "List encrypted backups", "createBackup": "Create encrypted SQLite snapshot", "restoreBackup": "Validate and schedule restore on restart", "cancelRestore": "Cancel pending restore", "listNotifications": "List latest offline notifications",
		"health": "Process liveness", "ready": "SQLite readiness", "version": "Product version",
		"login": "Log in", "session": "Get current session", "logout": "Log out",
		"createNode": "Create pending node and one-time enrollment token", "revokeEnrollment": "Revoke enrollment token",
		"enrollAgent": "Enroll Agent", "agentChallenge": "Create Agent challenge", "agentSession": "Create Agent session",
		"agentWebSocket": "Connect Agent WebSocket", "listNodes": "List nodes", "revokeNode": "Revoke node identity",
		"createTask": "Submit node task", "getTask": "Get task", "events": "Subscribe to server events",
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
