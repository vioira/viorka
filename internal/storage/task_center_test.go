package storage

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
)

func TestTaskCenterPaginationMetadataAndSummary(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	_, err = s.db.Exec(`INSERT INTO nodes(id,name,kind,state,created_at) VALUES('n1','First','vps','offline',?),('n2','Second','nat','offline',?)`, now(), now())
	if err != nil {
		t.Fatal(err)
	}
	empty, err := s.TaskSummary(ctx)
	if err != nil || empty.Total != 0 || empty.Active != 0 || empty.SuccessRate != nil {
		t.Fatalf("empty %+v %v", empty, err)
	}
	timestamp := at(time.Now().Add(-time.Hour))
	for _, v := range []struct {
		id, node, state, created string
		attempt                  int
	}{
		{"a", "n1", "queued", timestamp, 0},
		{"b", "n2", "failed", timestamp, 2},
		{"c", "n1", "failed", timestamp, 3},
		{"old", "n2", "queued", at(time.Now().Add(-25 * time.Hour)), 0},
	} {
		_, err = s.db.Exec(`INSERT INTO tasks(id,node_id,task_type,idempotency_key,state,attempt,last_error,payload_json,created_at,updated_at,deadline_at) VALUES(?,?,'node.inspect',?,?,?,'secret internal error','{"secret":"hidden payload"}',?,?,?)`, v.id, v.node, v.id+"-key", v.state, v.attempt, v.created, v.created, at(time.Now().Add(time.Minute)))
		if err != nil {
			t.Fatal(err)
		}
	}
	first, err := s.TaskPage(ctx, 2, "", "all")
	if err != nil || len(first.Items) != 2 || first.Items[0].ID != "c" || first.Items[1].ID != "b" || first.NextCursor != "b" {
		t.Fatalf("first %+v %v", first, err)
	}
	if first.Items[1].NodeName != "Second" || first.Items[1].Attempt != 2 || first.Items[1].MaxAttempts != 3 || first.Items[1].CreatedAt != timestamp {
		t.Fatalf("metadata %+v", first.Items[1])
	}
	b, _ := json.Marshal(first)
	if strings.Contains(string(b), "secret") || strings.Contains(string(b), "payload") {
		t.Fatal("private task data exposed", string(b))
	}
	// A later insertion and a state change of the cursor do not shift the next page.
	_, err = s.db.Exec(`INSERT INTO tasks(id,node_id,task_type,idempotency_key,state,created_at,updated_at,deadline_at) VALUES('new','n1','node.inspect','new-key','queued',?,?,?)`, now(), now(), at(time.Now().Add(time.Minute)))
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.db.Exec(`UPDATE tasks SET state='succeeded' WHERE id='b'`)
	if err != nil {
		t.Fatal(err)
	}
	next, err := s.TaskPage(ctx, 2, "b", "all")
	if err != nil || len(next.Items) != 2 || next.Items[0].ID != "a" || next.NextCursor != "" {
		t.Fatalf("next %+v %v", next, err)
	}
	failed, err := s.TaskPage(ctx, 1, "", "failed")
	if err != nil || len(failed.Items) != 1 || failed.Items[0].ID != "c" || failed.NextCursor != "" {
		t.Fatalf("failed %+v %v", failed, err)
	}
	if _, err = s.TaskPage(ctx, 2, "missing", "all"); !errors.Is(err, auth.ErrInvalid) {
		t.Fatal(err)
	}
	summary, err := s.TaskSummary(ctx)
	if err != nil || summary.Total != 4 || summary.Succeeded != 1 || summary.Failed != 1 || summary.Active != 3 || summary.SuccessRate == nil || *summary.SuccessRate != 50 {
		t.Fatalf("summary %+v %v", summary, err)
	}
	// Known expiry codes are public; arbitrary errors stay private.
	_, err = s.db.Exec(`UPDATE tasks SET last_error='deadline_exceeded' WHERE id='c'`)
	if err != nil {
		t.Fatal(err)
	}
	task, err := s.Task(ctx, "c")
	if err != nil || task.ErrorCode != "deadline_exceeded" {
		t.Fatalf("error code %+v %v", task, err)
	}

	_, err = s.db.Exec(`UPDATE tasks SET result_json='{"state":"failed","error_code":"inspection_failed"}' WHERE id='c'`)
	if err != nil {
		t.Fatal(err)
	}
	task, err = s.Task(ctx, "c")
	if err != nil || task.ErrorCode != "inspection_failed" {
		t.Fatalf("Agent error code %+v %v", task, err)
	}
	s.Close()
	if _, err = s.TaskSummary(ctx); err == nil {
		t.Fatal("summary masked unavailable storage")
	}
	if _, err = s.TaskPage(ctx, 1, "", "all"); err == nil {
		t.Fatal("list masked unavailable storage")
	}
}
