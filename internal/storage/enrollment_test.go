package storage

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/monitoring"
)

func TestNodeKindConstraint(t *testing.T) {
	s := testStore(t)
	for _, kind := range []string{"vps", "nat"} {
		if _, err := s.db.Exec(`INSERT INTO nodes(id,name,kind,created_at) VALUES(?,?,?,'now')`, kind, kind, kind); err != nil {
			t.Fatal(err)
		}
	}
	for _, kind := range []string{"relay", "unknown", ""} {
		if _, err := s.db.Exec(`INSERT INTO nodes(id,name,kind,created_at) VALUES('invalid','invalid',?,'now')`, kind); err == nil {
			t.Fatalf("insert accepted invalid kind %q", kind)
		}
		if _, err := s.db.Exec(`UPDATE nodes SET kind=? WHERE id='vps'`, kind); err == nil {
			t.Fatalf("update accepted invalid kind %q", kind)
		}
	}
	node, err := s.Node(context.Background(), "vps")
	if err != nil || node.Kind != "vps" {
		t.Fatal("rejected update changed node", node, err)
	}
}

func TestRenewEnrollmentAuditRollbackAndExpiry(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://panel.test")
	e, err := a.CreateEnrollment(ctx, "admin", "pending", "vps")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.RenewEnrollment(ctx, "missing-actor", e.ID); err == nil {
		t.Fatal("audit should fail")
	}
	var hash string
	if err = s.db.QueryRow(`SELECT enrollment_token_hash FROM nodes WHERE id=?`, e.ID).Scan(&hash); err != nil || hash != auth.Hash(e.Token) {
		t.Fatal("failed audit changed token", err)
	}
	if _, err = s.db.Exec(`UPDATE nodes SET enrollment_expires_at=? WHERE id=?`, at(time.Now().Add(-time.Hour)), e.ID); err != nil {
		t.Fatal(err)
	}
	renewed, err := a.RenewEnrollment(ctx, "admin", e.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Enroll(ctx, auth.Hash(e.Token), "old-key"); !errors.Is(err, auth.ErrUnauthorized) {
		t.Fatal(err)
	}
	if id, err := s.Enroll(ctx, auth.Hash(renewed.Token), "new-key"); err != nil || id != e.ID {
		t.Fatal(id, err)
	}
}

func TestConcurrentRenewalAndEnrollment(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://panel.test")
	for i := 0; i < 10; i++ {
		e, err := a.CreateEnrollment(ctx, "admin", "pending", "vps")
		if err != nil {
			t.Fatal(err)
		}
		start := make(chan struct{})
		var wg sync.WaitGroup
		var renewed auth.Enrollment
		var renewalErr, enrollmentErr error
		wg.Add(2)
		go func() { defer wg.Done(); <-start; renewed, renewalErr = a.RenewEnrollment(ctx, "admin", e.ID) }()
		go func() { defer wg.Done(); <-start; _, enrollmentErr = s.Enroll(ctx, auth.Hash(e.Token), e.ID) }()
		close(start)
		wg.Wait()
		if renewalErr == nil {
			if !errors.Is(enrollmentErr, auth.ErrUnauthorized) {
				t.Fatal("old token won after renewal", enrollmentErr)
			}
			if _, err = s.Enroll(ctx, auth.Hash(renewed.Token), e.ID); err != nil {
				t.Fatal(err)
			}
		} else if !errors.Is(renewalErr, auth.ErrConflict) || enrollmentErr != nil {
			t.Fatal("unexpected race outcome", renewalErr, enrollmentErr)
		}
	}
}

func TestResetEnrollmentPreservesHistoryAndRollsBack(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a := auth.NewAgents(s, "https://panel.test")
	e, err := a.CreateEnrollment(ctx, "admin", "original-name", "nat")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Enroll(ctx, auth.Hash(e.Token), "old-key"); err != nil {
		t.Fatal(err)
	}
	task, err := s.CreateTask(ctx, "admin", e.ID, "history")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.ResetEnrollment(ctx, "admin", e.ID); !errors.Is(err, auth.ErrConflict) {
		t.Fatal("unfinished task allowed reset", err)
	}
	if _, err = s.db.Exec(`UPDATE tasks SET state='succeeded' WHERE id=?`, task.ID); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{
		`INSERT INTO node_addresses(id,node_id,kind,address) VALUES('address',?,'hostname','example.test')`,
		`INSERT INTO config_revisions(id,node_id,resource_kind,resource_id,revision,sha256,desired_json,created_at) VALUES('revision',?,'proxy','service',1,'hash','{"preserved":true}','now')`,
	} {
		if _, err = s.db.Exec(q, e.ID); err != nil {
			t.Fatal(err)
		}
	}
	at := time.Now().UTC().Truncate(30 * time.Second)
	if err = s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{historyFixture(e.ID, at, 1)}, at); err != nil {
		t.Fatal(err)
	}
	if _, err = a.ResetEnrollment(ctx, "missing-actor", e.ID); err == nil {
		t.Fatal("audit should fail")
	}
	if key, err := s.AgentKey(ctx, e.ID); err != nil || key != "old-key" {
		t.Fatal("rollback lost identity", err)
	}
	if err = a.Revoke(ctx, "admin", e.ID); err != nil {
		t.Fatal(err)
	}
	renewed, err := a.ResetEnrollment(ctx, "admin", e.ID)
	if err != nil {
		t.Fatal(err)
	}
	if renewed.ID != e.ID {
		t.Fatal("node id changed")
	}
	if _, err = s.Enroll(ctx, auth.Hash(renewed.Token), "new-key"); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"node_addresses", "config_revisions", "metrics_history", "tasks"} {
		var count int
		if err = s.db.QueryRow(`SELECT count(*) FROM `+table+` WHERE node_id=?`, e.ID).Scan(&count); err != nil || count != 1 {
			t.Fatal(table, count, err)
		}
	}
	var desired string
	var stats float64
	if err = s.db.QueryRow(`SELECT desired_json FROM config_revisions WHERE node_id=?`, e.ID).Scan(&desired); err != nil || desired != `{"preserved":true}` {
		t.Fatal("configuration changed", desired, err)
	}
	if err = s.db.QueryRow(`SELECT cpu_sum FROM metrics_history WHERE node_id=?`, e.ID).Scan(&stats); err != nil || stats != 20 {
		t.Fatal("metric history changed", stats, err)
	}
	n, err := s.Node(ctx, e.ID)
	if err != nil || n.Name != "original-name" || n.Kind != "nat" || n.State != "offline" {
		t.Fatal(n, err)
	}
	preserved, err := s.Task(ctx, task.ID)
	if err != nil || preserved.State != "succeeded" {
		t.Fatal("task history changed", err)
	}
	var count int
	if err = s.db.QueryRow(`SELECT count(*) FROM audit_logs WHERE resource_id=? AND action IN ('node.create','task.create','node.revoke','node.enrollment.reset')`, e.ID).Scan(&count); err != nil || count != 4 {
		t.Fatal("audit history", count, err)
	}
}
