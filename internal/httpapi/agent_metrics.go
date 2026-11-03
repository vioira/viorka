package httpapi

import (
	"context"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func (a *api) agentMetrics(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" || r.Header.Get("Origin") != "" || len(r.Header.Values("Cookie")) != 0 {
		fail(w, 403, "forbidden", "Agent 指标接口不接受浏览器身份或查询参数")
		return
	}
	values := r.Header.Values("Authorization")
	if len(values) != 1 || !strings.HasPrefix(values[0], "Bearer ") || len(values[0]) != 71 {
		fail(w, 401, "session_invalid", "Agent 会话无效")
		return
	}
	token := strings.TrimPrefix(values[0], "Bearer ")
	node, _, err := a.Agents.Authenticate(r.Context(), token)
	if err != nil {
		agentMetricsAuthError(w, err)
		return
	}
	if a.Telemetry == nil {
		fail(w, 409, "unsupported_protocol", "尚未启用新版指标协议")
		return
	}
	if !a.admitMetricUpload(r.Context()) {
		w.Header().Set("Retry-After", "1")
		fail(w, 503, "overloaded", "指标上传繁忙，请稍后重试")
		return
	}
	defer func() { <-a.metricUploads }()
	media, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || len(params) != 0 || r.Header.Get("Content-Encoding") != "" {
		fail(w, 415, "unsupported_media_type", "请使用未压缩的 application/json")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, v1.TelemetryMaxBodyBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			fail(w, 413, "payload_too_large", "指标批次超过大小限制")
		} else {
			fail(w, 400, "invalid_batch", "无法读取指标批次")
		}
		return
	}
	// Body reads may take time; check revocation/expiration again before admission.
	current, _, err := a.Agents.Authenticate(r.Context(), token)
	if err != nil {
		agentMetricsAuthError(w, err)
		return
	}
	if current != node {
		fail(w, 401, "session_invalid", "Agent 会话无效")
		return
	}
	receipt, err := a.Telemetry.Receive(r.Context(), node, auth.Hash(token), "", raw, true, time.Now())
	if err == nil {
		writeJSON(w, 200, receipt)
		return
	}
	status, code := 400, "invalid_batch"
	switch {
	case errors.Is(err, monitoring.ErrTelemetrySession), errors.Is(err, monitoring.ErrTelemetryRun):
		status, code = 409, "stale_session"
	case errors.Is(err, monitoring.ErrTelemetryRate):
		status, code = 429, "rate_limited"
		w.Header().Set("Retry-After", "1")
	case errors.Is(err, monitoring.ErrTelemetryOverloaded):
		status, code = 503, "overloaded"
		w.Header().Set("Retry-After", "1")
	}
	if receipt.BatchID != "" {
		receipt.State = "rejected"
		receipt.ErrorCode = code
		receipt.AcceptedCount = 0
		receipt.DuplicateCount = 0
		writeJSON(w, status, receipt)
		return
	}
	fail(w, status, code, "指标批次未被接受")
}
func agentMetricsAuthError(w http.ResponseWriter, err error) {
	code := "session_invalid"
	switch {
	case errors.Is(err, auth.ErrAgentSessionExpired):
		code = "session_expired"
	case errors.Is(err, auth.ErrAgentIdentityRevoked):
		code = "identity_revoked"
	case errors.Is(err, auth.ErrAgentNodeDisabled):
		code = "node_disabled"
	case !errors.Is(err, auth.ErrUnauthorized):
		fail(w, 503, "unavailable", "暂时无法验证 Agent 会话")
		return
	}
	fail(w, 401, code, "Agent 会话不可用")
}

// Keep the existing eight body readers. Up to 56 additional authenticated
// requests may wait before allocating a body buffer, for at most 250ms. This
// absorbs short synchronized reports without an unbounded request queue or
// increasing the 8MiB maximum concurrent HTTP body allocation.
func (a *api) admitMetricUpload(ctx context.Context) bool {
	if ctx.Err() != nil {
		return false
	}
	select {
	case a.metricUploads <- struct{}{}:
		return true
	default:
	}
	select {
	case a.metricUploadWaiters <- struct{}{}:
		defer func() { <-a.metricUploadWaiters }()
	default:
		return false
	}
	timer := time.NewTimer(250 * time.Millisecond)
	defer timer.Stop()
	select {
	case a.metricUploads <- struct{}{}:
		if ctx.Err() != nil {
			<-a.metricUploads
			return false
		}
		return true
	case <-ctx.Done():
		return false
	case <-timer.C:
		return false
	}
}
