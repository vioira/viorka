package storage

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/monitoring"
)

func deletionStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(context.Background(), filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	if err = s.Bootstrap(context.Background(), auth.User{ID: "admin", Username: "admin", Role: "admin", PasswordHash: "unused"}); err != nil {
		t.Fatal(err)
	}
	metricNode(t, s, "target")
	metricNode(t, s, "other")
	return s
}

func TestDeleteNodeCascadesAndPreservesAudit(t *testing.T) {
	s := deletionStore(t)
	ctx := context.Background()
	for _, node := range []string{"target", "other"} {
		statements := []string{
			`INSERT INTO agent_credentials(id,node_id,public_key,status,created_at) VALUES(?,?,hex(randomblob(32)),'active','now')`,
			`INSERT INTO agent_sessions(token_hash,node_id,expires_at) VALUES(?,?,'future')`,
			`INSERT INTO agent_challenges(id,node_id,message,expires_at) VALUES(?,?,'message','future')`,
			`INSERT INTO node_addresses(id,node_id,kind,address) VALUES(?,?,'hostname','example.test')`,
			`INSERT INTO port_allocations(id,node_id,public_host,public_port,private_host,private_port,transport,owner,created_at) VALUES(?,?,'example.test',443,'127.0.0.1',443,'tcp','manual','now')`,
			`INSERT INTO notifications(id,node_id,created_at,message) VALUES(?,?,'now','offline')`,
		}
		for _, statement := range statements {
			if _, err := s.db.Exec(statement, node, node); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := s.CreateTask(ctx, "admin", node, "inspect"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.db.Exec(`UPDATE tasks SET state='succeeded'`); err != nil {
		t.Fatal(err)
	}
	at := time.Now().UTC().Truncate(time.Minute)
	rows := []monitoring.NodeHistory{historyFixture("target", at, 1), historyFixture("other", at, 1)}
	if err := s.SaveTelemetryHistory(ctx, rows, at); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteNode(ctx, "admin", "target"); err != nil {
		t.Fatal(err)
	}
	// A recorder flush captured before deletion must neither recreate history
	// nor prevent another node's buckets from being saved.
	if err := s.SaveTelemetryHistory(ctx, rows, at); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"agent_credentials", "agent_sessions", "agent_challenges", "node_addresses", "port_allocations", "notifications", "tasks", "metrics_history"} {
		var removed, retained int
		if err := s.db.QueryRow(`SELECT count(*) FROM ` + table + ` WHERE node_id='target'`).Scan(&removed); err != nil {
			t.Fatal(err)
		}
		if err := s.db.QueryRow(`SELECT count(*) FROM ` + table + ` WHERE node_id='other'`).Scan(&retained); err != nil || removed != 0 || retained != 1 {
			t.Fatalf("%s: removed=%d retained=%d err=%v", table, removed, retained, err)
		}
	}
	var count int
	if err := s.db.QueryRow(`SELECT count(*) FROM audit_logs WHERE resource_id='target' AND action IN ('task.create','node.delete')`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("audit lost: %d %v", count, err)
	}
	if _, err := s.Node(ctx, "target"); !errors.Is(err, auth.ErrNotFound) {
		t.Fatal("node still exists", err)
	}
	if err := s.DeleteNode(ctx, "admin", "target"); !errors.Is(err, auth.ErrNotFound) {
		t.Fatal("repeat delete", err)
	}
}

func TestDeleteNodeRejectsDependencies(t *testing.T) {
	for name, statement := range map[string]string{
		"engine":         `INSERT INTO engines(id,node_id,name) VALUES('e','target','xray')`,
		"outgoing relay": `INSERT INTO relay_rules(id,source_node_id,destination_node_id,engine_id,listen_host,listen_port,target_host,target_port,transport) VALUES('r','target','other','e','127.0.0.1',443,'example.test',443,'tcp')`,
		"incoming relay": `INSERT INTO relay_rules(id,source_node_id,destination_node_id,engine_id,listen_host,listen_port,target_host,target_port,transport) VALUES('r','other','target','e','127.0.0.1',443,'example.test',443,'tcp')`,
		"service":        `INSERT INTO proxy_services(id,node_id,engine_id,name,protocol,listen_host,listen_port,transport,created_at) VALUES('p','target','e','proxy','test','127.0.0.1',443,'tcp','now')`,
		"revision":       `INSERT INTO config_revisions(id,node_id,resource_kind,resource_id,revision,sha256,desired_json,created_at) VALUES('r','target','proxy','p',1,'hash','{}','now')`,
		"deployment":     `INSERT INTO deployments(id,node_id,resource_kind,resource_id,desired_revision,status,updated_at) VALUES('d','target','proxy','p',1,'healthy','now')`,
	} {
		t.Run(name, func(t *testing.T) {
			s := deletionStore(t)
			if name != "engine" {
				if _, err := s.db.Exec(`INSERT INTO engines(id,node_id,name) VALUES('e','other','xray')`); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := s.db.Exec(statement); err != nil {
				t.Fatal(err)
			}
			if err := s.DeleteNode(context.Background(), "admin", "target"); !errors.Is(err, inventory.ErrNodeReferenced) {
				t.Fatal(err)
			}
			if _, err := s.Node(context.Background(), "target"); err != nil {
				t.Fatal("rejected deletion changed node", err)
			}
		})
	}
}

func TestDeleteNodeRejectsActiveTasks(t *testing.T) {
	for _, state := range []string{"queued", "dispatched", "accepted", "running"} {
		t.Run(state, func(t *testing.T) {
			s := deletionStore(t)
			ctx := context.Background()
			if _, err := s.CreateTask(ctx, "admin", "target", "inspect"); err != nil {
				t.Fatal(err)
			}
			if _, err := s.db.Exec(`UPDATE tasks SET state=?`, state); err != nil {
				t.Fatal(err)
			}
			if err := s.DeleteNode(ctx, "admin", "target"); !errors.Is(err, inventory.ErrNodeBusy) {
				t.Fatal(err)
			}
		})
	}
}

func TestDeleteNodeAuditFailureRollsBack(t *testing.T) {
	s := deletionStore(t)
	if _, err := s.db.Exec(`CREATE TRIGGER fail_delete_audit BEFORE INSERT ON audit_logs WHEN NEW.action='node.delete' BEGIN SELECT RAISE(ABORT,'test failure'); END`); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := s.DeleteNode(ctx, "admin", "target"); err == nil {
		t.Fatal("audit failure ignored")
	}
	if _, err := s.Node(ctx, "target"); err != nil {
		t.Fatal("failed transaction deleted node", err)
	}
}

func TestDeleteNodeConcurrentTaskCreation(t *testing.T) {
	s := deletionStore(t)
	for i := 0; i < 20; i++ {
		id := auth.Random()
		metricNode(t, s, id)
		var deletion, creation error
		var wg sync.WaitGroup
		start := make(chan struct{})
		wg.Add(2)
		go func() { defer wg.Done(); <-start; deletion = s.DeleteNode(context.Background(), "admin", id) }()
		go func() {
			defer wg.Done()
			<-start
			_, creation = s.CreateTask(context.Background(), "admin", id, "inspect")
		}()
		close(start)
		wg.Wait()
		if deletion == nil && errors.Is(creation, auth.ErrNotFound) {
			continue
		}
		if creation == nil && errors.Is(deletion, inventory.ErrNodeBusy) {
			continue
		}
		t.Fatalf("non-atomic deletion/task creation: delete=%v create=%v", deletion, creation)
	}
}
