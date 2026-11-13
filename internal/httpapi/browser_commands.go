package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Only these existing, authenticated JSON operations are exposed to the browser
// socket. The same handler owns validation, authorization, transactions and audit
// for both transports; no loopback HTTP request or arbitrary URL is accepted.
var browserOperations = map[string]bool{
	"deleteNode": true, "revokeNode": true, "resetEnrollment": true, "renewEnrollment": true, "revokeEnrollment": true,
	"getNode": true, "listNodeTasks": true, "getTask": true, "createTask": true,
	"engineCatalog": true, "listEngines": true, "getEngine": true,
	"saveEngineDraft": true, "installEngine": true, "engineAction": true,
	"engineConnections": true, "retryEngineSync": true, "grantEngineAccess": true,
	"getTelemetrySettings": true, "getTelemetrySettingsStatus": true, "saveTelemetrySettings": true,
	"calibrateTraffic": true, "nodeMetricHistory": true, "nodeMetricTrends": true, "nodeTCPProbeHistory": true,
	"listProtocolPresets": true, "getProtocolPreset": true,
	"listOutbounds": true,
}

type browserCommand struct {
	method, path string
	handler      http.HandlerFunc
}
type browserParams struct {
	ID    string            `json:"id,omitempty"`
	Query map[string]string `json:"query,omitempty"`
	Body  json.RawMessage   `json:"body,omitempty"`
}
type browserChangeSubscription struct {
	Kind    string `json:"kind"`
	NodeID  string `json:"node_id,omitempty"`
	Through string `json:"through,omitempty"`
	All     bool   `json:"all,omitempty"`
}

type browserMessage struct {
	TCPHistory *browserTCPHistorySubscription `json:"tcp_history,omitempty"`
	Changes    []browserChangeSubscription    `json:"changes,omitempty"`
	Type       string                         `json:"type"`
	ID         string                         `json:"id,omitempty"`
	Method     string                         `json:"method,omitempty"`
	Params     browserParams                  `json:"params,omitempty"`
	CSRF       string                         `json:"csrf,omitempty"`
	Scope      string                         `json:"scope,omitempty"`
	Generation uint64                         `json:"generation,omitempty"`
	Node       string                         `json:"node,omitempty"`
	Engine     string                         `json:"engine,omitempty"`
	Enabled    bool                           `json:"enabled,omitempty"`
}
type browserFrame struct {
	Type       string `json:"type"`
	ID         string `json:"id,omitempty"`
	Event      string `json:"event,omitempty"`
	Generation uint64 `json:"generation,omitempty"`
	Status     int    `json:"status,omitempty"`
	Data       any    `json:"data,omitempty"`
}

var browserID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)

// A bounded JSON sink adapts the shared handler without importing test helpers
// or retaining HTTP headers, cookies or credentials in the response message.
type browserResponse struct {
	header   http.Header
	status   int
	body     bytes.Buffer
	overflow bool
}

func (w *browserResponse) Header() http.Header { return w.header }
func (w *browserResponse) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
	}
}
func (w *browserResponse) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	if w.body.Len()+len(b) > 8<<20 {
		w.overflow = true
		return 0, io.ErrShortBuffer
	}
	return w.body.Write(b)
}
func executeBrowserCommand(parent *http.Request, csrf string, command browserCommand, message browserMessage) browserFrame {
	result := browserFrame{Type: "response", ID: message.ID}
	if strings.Contains(command.path, "{id}") && !browserID.MatchString(message.Params.ID) {
		result.Status = 400
		result.Data = ErrorResponse{Code: "invalid_request", Message: "资源标识无效"}
		return result
	}
	ctx, cancel := context.WithTimeout(parent.Context(), 10*time.Second)
	defer cancel()
	r := parent.Clone(ctx)
	r.Method = command.method
	path := strings.ReplaceAll(command.path, "{id}", message.Params.ID)
	query := url.Values{}
	for key, value := range message.Params.Query {
		query.Set(key, value)
	}
	r.URL = &url.URL{Path: path, RawQuery: query.Encode()}
	r.RequestURI = r.URL.RequestURI()
	r.SetPathValue("id", message.Params.ID)
	r.Body = io.NopCloser(bytes.NewReader(message.Params.Body))
	r.ContentLength = int64(len(message.Params.Body))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-CSRF-Token", csrf)
	sink := &browserResponse{header: make(http.Header)}
	command.handler(sink, r)
	result.Status = sink.status
	if sink.overflow || (sink.body.Len() > 0 && !json.Valid(sink.body.Bytes())) {
		result.Status = 503
		result.Data = ErrorResponse{Code: "response_unavailable", Message: "响应过大或无效，请缩小查询范围"}
	} else if sink.body.Len() > 0 {
		result.Data = json.RawMessage(sink.body.Bytes())
	}
	return result
}
