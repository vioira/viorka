package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/alerts"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestAlertIncidentAndOutbox(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.InitSettings(ctx, "https://panel.test"); err != nil {
		t.Fatal(err)
	}
	metricNode(t, s, "n")
	view, err := s.AlertSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	c := view.Config
	c.Timezone = "Asia/Shanghai"
	c.Channels = []alerts.Channel{{ID: "tg", Name: "运维", Kind: "telegram", Target: "-123"}, {ID: "b", Name: "手机", Kind: "bark", Target: "https://api.day.app"}}
	r := alerts.Rule{ID: "cpu", Name: "负载", Metric: "cpu", Mode: "all", Threshold: 85, WindowMinutes: 1, RepeatMinutes: 2, Enabled: true, Recovery: true, Template: "default", Channels: []string{"tg", "b"}, Nodes: []string{"n"}}
	c.Rules = append(c.Rules, r)
	edit := alerts.Edit{Config: c, Secrets: map[string]string{"tg": "123:test", "b": "test-key"}}
	if err = s.SaveAlertSettings(ctx, "admin", edit); err != nil {
		t.Fatal(err)
	}
	if err = s.SaveAlertSettings(ctx, "admin", edit); !errors.Is(err, auth.ErrConflict) {
		t.Fatal(err)
	}
	var raw, encrypted string
	if err = s.db.QueryRow("SELECT config_json,secret_encrypted FROM alert_config,alert_channels WHERE alert_channels.id='tg'").Scan(&raw, &encrypted); err != nil || strings.Contains(raw, "123:test") || strings.Contains(encrypted, "123:test") {
		t.Fatal("plaintext credentials", err)
	}
	start := time.Now().Add(time.Second)
	w := alerts.Windows{}
	cfg := v1.DefaultTelemetrySettings()
	sample := func(sec int, v float64) {
		t.Helper()
		now := start.Add(time.Duration(sec) * time.Second)
		b := v1.TelemetryBatch{NodeID: "n", RunID: "run", Fast: []*v1.TelemetryFast{{Sequence: uint64(sec + 1), SampledAt: now, CPUPercent: &v}}}
		if e := s.EvaluateAlerts(ctx, b, cfg, true, [3]uint64{}, now, &w); e != nil {
			t.Fatal(e)
		}
	}
	count := func(want int) {
		t.Helper()
		items, e := s.Notifications(ctx, "admin")
		if e != nil || len(items) != want {
			t.Fatalf("inbox %d, want %d: %v", len(items), want, e)
		}
		var n int
		if e = s.db.QueryRow("SELECT count(*) FROM alert_deliveries").Scan(&n); e != nil || n != want*2 {
			t.Fatalf("outbox %d, want %d: %v", n, want*2, e)
		}
	}
	for _, sec := range []int{0, 30, 60, 90, 120, 150} {
		sample(sec, 95)
	}
	count(1)
	sample(180, 95)
	count(2)
	sample(210, 80)
	sample(240, 95)
	count(2)
	sample(270, 85)
	sample(300, 80)
	sample(330, 80)
	count(3)
	items, _ := s.Notifications(ctx, "admin")
	if items[0].EventKind != "recovery" || items[0].Title != "已恢复：负载" || !strings.Contains(items[0].Message, "已恢复") || !strings.Contains(items[0].Message, "+08:00") {
		t.Fatal(items[0].Message)
	}
	for _, sec := range []int{360, 390, 420} {
		sample(sec, 92)
	}
	count(4)
	sample(420, 92)
	count(4)
}

func TestWindowAdmissionIsAtomicOnRetry(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	if e := s.InitSettings(ctx, "https://test.example"); e != nil {
		t.Fatal(e)
	}
	metricNode(t, s, "node-demo")
	view, e := s.AlertSettings(ctx)
	if e != nil {
		t.Fatal(e)
	}
	view.Config.Rules = append(view.Config.Rules, alerts.Rule{ID: "high", Name: "CPU", Metric: "cpu", Mode: "average", Threshold: 10, WindowMinutes: 1, Enabled: true, Nodes: []string{}, Channels: []string{}, Template: "default"})
	if e = s.SaveAlertSettings(ctx, "admin", alerts.Edit{Config: view.Config}); e != nil {
		t.Fatal(e)
	}
	now := time.Now().Add(time.Second)
	rec, e := monitoring.NewTelemetryRecorder(ctx, s, now)
	if e != nil {
		t.Fatal(e)
	}
	ingress := monitoring.NewTelemetryIngress(rec)
	ingress.ConfigureAlerts(s)
	key := strings.Repeat("a", 64)
	if e = ingress.Activate("node-demo", key, "generation", now.Add(time.Hour), v1.DefaultTelemetrySettings(), now); e != nil {
		t.Fatal(e)
	}
	raw, e := os.ReadFile("../../api/agent/v1/examples/node.metrics.v3.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixture struct {
		Payload v1.TelemetryBatch `json:"payload"`
	}
	if e = json.Unmarshal(raw, &fixture); e != nil {
		t.Fatal(e)
	}
	batch := fixture.Payload
	send := func(seq int) (v1.TelemetryReceipt, error) {
		t.Helper()
		at := now.Add(time.Duration(seq-1) * 30 * time.Second)
		batch.Fast[0].Sequence = uint64(seq)
		batch.Fast[0].SampledAt = at
		batch.Full = []*v1.TelemetryFull{}
		b, e := json.Marshal(batch)
		if e != nil {
			t.Fatal(e)
		}
		return ingress.Receive(ctx, "node-demo", key, "", b, true, at)
	}
	for _, i := range []int{1, 2} {
		if _, e := send(i); e != nil {
			t.Fatal(e)
		}
	}
	if _, e = s.db.Exec("CREATE TRIGGER fail_alert BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'test rollback'); END"); e != nil {
		t.Fatal(e)
	}
	if _, e = send(3); !errors.Is(e, monitoring.ErrTelemetryOverloaded) {
		t.Fatal("expected retry", e)
	}
	if _, e = s.db.Exec("DROP TRIGGER fail_alert"); e != nil {
		t.Fatal(e)
	}
	if receipt, e := send(3); e != nil || receipt.AcceptedCount != 1 {
		t.Fatal(receipt, e)
	}
	if receipt, e := send(3); e != nil || receipt.DuplicateCount != 1 {
		t.Fatal(receipt, e)
	}
	items, e := s.Notifications(ctx, "admin")
	if e != nil || len(items) != 1 {
		t.Fatal(items, e)
	}
}

func TestAlertDeliveryRetriesAreIndependent(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	if e := s.InitSettings(ctx, "https://example.test"); e != nil {
		t.Fatal(e)
	}
	view, e := s.AlertSettings(ctx)
	if e != nil {
		t.Fatal(e)
	}
	view.Config.Channels = []alerts.Channel{{ID: "first", Name: "值班", Kind: "telegram", Target: "-123"}, {ID: "next", Name: "备用", Kind: "bark", Target: "https://api.day.app"}}
	if e = s.SaveAlertSettings(ctx, "admin", alerts.Edit{Config: view.Config, Secrets: map[string]string{"first": "123:test", "next": "test-key"}}); e != nil {
		t.Fatal(e)
	}
	for _, ch := range view.Config.Channels {
		if e = s.TestAlertChannel(ctx, ch.ID, "admin"); e != nil {
			t.Fatal(e)
		}
	}
	j, e := s.claimAlertJob(ctx)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.completeAlertJob(ctx, j, alerts.SendResult{Retry: true, Detail: "等待重试"}); e != nil {
		t.Fatal(e)
	}
	second, e := s.claimAlertJob(ctx)
	if e != nil || second.ch.ID == j.ch.ID {
		t.Fatal(second.ch.ID, e)
	}
	if e = s.completeAlertJob(ctx, second, alerts.SendResult{Accepted: true, Detail: "渠道已接受消息"}); e != nil {
		t.Fatal(e)
	}
	v, e := s.AlertSettings(ctx)
	if e != nil || v.Delivery[second.ch.ID].State != "accepted" || v.Delivery[j.ch.ID].State != "retry" {
		t.Fatal(v.Delivery, e)
	}
	for attempt := 2; attempt <= 5; attempt++ {
		if _, e = s.db.Exec("UPDATE alert_deliveries SET due_ms=0"); e != nil {
			t.Fatal(e)
		}
		retry, e := s.claimAlertJob(ctx)
		if e != nil || retry.id != j.id || retry.attempt != attempt {
			t.Fatal(retry.id, e)
		}
		if e = s.completeAlertJob(ctx, retry, alerts.SendResult{Retry: true, Detail: "重试失败"}); e != nil {
			t.Fatal(e)
		}
	}
	v, e = s.AlertSettings(ctx)
	if e != nil || v.Delivery[j.ch.ID].State != "failed" {
		t.Fatal(v.Delivery, e)
	}
	if _, e = s.claimAlertJob(ctx); !errors.Is(e, sql.ErrNoRows) {
		t.Fatal(e)
	}
}

func TestRestoreClearsAlertSecretsAndPendingPush(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	if e := s.InitSettings(ctx, "https://example.test"); e != nil {
		t.Fatal(e)
	}
	view, e := s.AlertSettings(ctx)
	if e != nil {
		t.Fatal(e)
	}
	view.Config.Channels = []alerts.Channel{{ID: "b", Name: "手机", Kind: "bark", Target: "https://api.day.app"}}
	if e = s.SaveAlertSettings(ctx, "admin", alerts.Edit{Config: view.Config, Secrets: map[string]string{"b": "test-key"}}); e != nil {
		t.Fatal(e)
	}
	if e = s.TestAlertChannel(ctx, "b", "admin"); e != nil {
		t.Fatal(e)
	}
	path := filepath.Join(t.TempDir(), "restored.db")
	if e = s.Backup(ctx, path); e != nil {
		t.Fatal(e)
	}
	if e = ValidateSnapshot(ctx, path); e != nil {
		t.Fatal(e)
	}
	if e = PrepareRestoredSnapshot(ctx, path); e != nil {
		t.Fatal(e)
	}
	restored, e := snapshotDB(path, true)
	if e != nil {
		t.Fatal(e)
	}
	defer restored.Close()
	var secret string
	var pending int
	if e = restored.QueryRow("SELECT secret_encrypted,(SELECT count(*) FROM alert_deliveries) FROM alert_channels WHERE id='b'").Scan(&secret, &pending); e != nil || secret != "" || pending != 0 {
		t.Fatal("restored push credentials or jobs still live", e)
	}
}

func TestBarkWorkerDeliversSavedChannel(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
	defer cancel()
	var received = make(chan map[string]string, 1)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/push" || r.URL.RawQuery != "" {
			http.Error(w, "bad request", 400)
			return
		}
		var msg map[string]string
		if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
			http.Error(w, "bad JSON", 400)
			return
		}
		select {
		case received <- msg:
		default:
			t.Error("message delivered twice")
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]int{"code": 200})
	}))
	defer server.Close()
	s := testStore(t)
	if e := s.InitSettings(ctx, "https://panel.test"); e != nil {
		t.Fatal(e)
	}
	cfg, e := s.AlertSettings(ctx)
	if e != nil {
		t.Fatal(e)
	}
	cfg.Config.Channels = []alerts.Channel{{ID: "phone", Kind: "bark", Target: server.URL, Name: "值班手机"}}
	if e = s.SaveAlertSettings(ctx, "admin", alerts.Edit{Config: cfg.Config, Secrets: map[string]string{"phone": "fixture-key"}}); e != nil {
		t.Fatal(e)
	}
	if e = s.TestAlertChannel(ctx, "phone", "admin"); e != nil {
		t.Fatal(e)
	}
	stopped := make(chan struct{})
	go func() { defer close(stopped); s.runAlertDelivery(ctx, server.Client()) }()
	defer func() { cancel(); <-stopped }()
	select {
	case <-ctx.Done():
		t.Fatal("test push was not delivered")
	case msg := <-received:
		if msg["device_key"] != "fixture-key" || msg["title"] != "Viorka 测试通知" {
			t.Fatal("invalid test delivery")
		}
	}
	for ctx.Err() == nil {
		v, e := s.AlertSettings(ctx)
		if e != nil {
			t.Fatal(e)
		}
		if v.Delivery["phone"].State == "accepted" {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("missing provider receipt")
}
