package httpapi

import (
	"context"
	"github.com/vioira/viorka/internal/monitoring"
	"io"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMetricUploadBoundedWaiting(t *testing.T) {
	a := &api{metricUploads: make(chan struct{}, 1), metricUploadWaiters: make(chan struct{}, 1)}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if !a.admitMetricUpload(ctx) {
		t.Fatal("free reader rejected")
	}
	completed := make(chan bool, 1)
	go func() { completed <- a.admitMetricUpload(ctx) }()
	wait := time.NewTicker(time.Millisecond)
	defer wait.Stop()
	for len(a.metricUploadWaiters) != 1 {
		select {
		case <-ctx.Done():
			t.Fatal("waiter did not queue")
		case <-wait.C:
		}
	}
	if a.admitMetricUpload(ctx) {
		t.Fatal("unbounded queue admitted overflow")
	}
	<-a.metricUploads
	select {
	case ok := <-completed:
		if !ok {
			t.Fatal("short burst rejected despite released reader")
		}
	case <-ctx.Done():
		t.Fatal("queued reader stuck")
	}
	if len(a.metricUploads) != 1 || len(a.metricUploadWaiters) != 0 {
		t.Fatal("queue slot leaked")
	}
	start := time.Now()
	if a.admitMetricUpload(ctx) {
		t.Fatal("occupied reader admitted after wait deadline")
	}
	if elapsed := time.Since(start); elapsed < 200*time.Millisecond || elapsed > time.Second {
		t.Fatal("wait not bounded", elapsed)
	}
	if len(a.metricUploadWaiters) != 0 {
		t.Fatal("timed out waiter leaked")
	}
	canceled, stop := context.WithCancel(ctx)
	go func() { completed <- a.admitMetricUpload(canceled) }()
	for len(a.metricUploadWaiters) != 1 {
		select {
		case <-ctx.Done():
			t.Fatal("cancel waiter not queued")
		case <-wait.C:
		}
	}
	stop()
	select {
	case ok := <-completed:
		if ok {
			t.Fatal("canceled request admitted")
		}
	case <-ctx.Done():
		t.Fatal("cancellation not honored")
	}
	if len(a.metricUploads) != 1 || len(a.metricUploadWaiters) != 0 {
		t.Fatal("cancel changed reader ownership")
	}
	<-a.metricUploads
	if a.admitMetricUpload(canceled) {
		t.Fatal("already canceled request acquired free reader")
	}
	if !a.admitMetricUpload(ctx) {
		t.Fatal("capacity did not recover")
	}
	<-a.metricUploads
}

type metricUnreadBody struct{ reads int }

func (b *metricUnreadBody) Read([]byte) (int, error) { b.reads++; return 0, io.EOF }
func TestMetricUploadOverloadDoesNotReadBody(t *testing.T) {
	f := setupConfigured(t, "admin", true)
	node, key := f.enroll()
	token := f.token(node, key)
	a := &api{Dependencies: Dependencies{Agents: f.agents, Telemetry: monitoring.NewTelemetryIngress(f.recorder)}, metricUploads: make(chan struct{}, 8), metricUploadWaiters: make(chan struct{}, 56)}
	for i := 0; i < 8; i++ {
		a.metricUploads <- struct{}{}
	}
	for i := 0; i < 56; i++ {
		a.metricUploadWaiters <- struct{}{}
	}
	body := &metricUnreadBody{}
	request := httptest.NewRequest("POST", "/api/v1/agents/metrics", body)
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	a.agentMetrics(response, request)
	if response.Code != 503 || response.Header().Get("Retry-After") != "1" || body.reads != 0 {
		t.Fatalf("overload response=%d reads=%d", response.Code, body.reads)
	}
	if len(a.metricUploads) != 8 || len(a.metricUploadWaiters) != 56 {
		t.Fatal("overflow consumed capacity")
	}
}
