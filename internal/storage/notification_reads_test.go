package storage

import (
	"context"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"testing"
)

func TestNotificationReadIsolationAndRetention(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	for _, query := range []string{
		"INSERT INTO users(id,username,password_hash,role,created_at) VALUES('other','other','hash','viewer','now')",
		"INSERT INTO nodes(id,name,kind,state,created_at) VALUES('node','node','vps','offline','now')",
		"INSERT INTO notifications(id,node_id,created_at,message) VALUES('notice','node','now','offline')",
	} {
		if _, err := s.db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	for _, read := range []bool{true, true, false, true} {
		if err := s.SetNotificationRead(ctx, "admin", "notice", read); err != nil {
			t.Fatal(err)
		}
		items, err := s.Notifications(ctx, "admin")
		if err != nil || len(items) != 1 || items[0].Read != read {
			t.Fatalf("read: %+v %v", items, err)
		}
		other, err := s.Notifications(ctx, "other")
		if err != nil || len(other) != 1 || other[0].Read {
			t.Fatalf("other user: %+v %v", other, err)
		}
	}
	if err := s.SetNotificationRead(ctx, "admin", "missing", true); !errors.Is(err, auth.ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := s.db.Exec("DELETE FROM notifications WHERE id='notice'"); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := s.db.QueryRow("SELECT count(*) FROM notification_reads").Scan(&count); err != nil || count != 0 {
		t.Fatalf("orphan read: %d %v", count, err)
	}
}

func TestBatchNotificationReadsAtomicAndScoped(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	for _, query := range []string{
		"INSERT INTO users(id,username,password_hash,role,created_at) VALUES('other','other','hash','viewer','now')",
		"INSERT INTO nodes(id,name,kind,state,created_at) VALUES('node','node','vps','offline','now')",
		"INSERT INTO notifications(id,node_id,created_at,message) VALUES('a','node','now','offline'),('b','node','now','offline'),('new','node','now','offline')",
	} {
		if _, err := s.db.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.MarkNotificationsRead(ctx, "admin", []string{"a", "missing"}); !errors.Is(err, auth.ErrNotFound) {
		t.Fatal(err)
	}
	items, err := s.Notifications(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.Read {
			t.Fatal("partial update on failed batch")
		}
	}
	for i := 0; i < 2; i++ {
		if err := s.MarkNotificationsRead(ctx, "admin", []string{"a", "b"}); err != nil {
			t.Fatal(err)
		}
	}
	for _, user := range []string{"admin", "other"} {
		items, err = s.Notifications(ctx, user)
		if err != nil || len(items) != 3 {
			t.Fatalf("%+v %v", items, err)
		}
		for _, item := range items {
			if item.Read != (user == "admin" && item.ID != "new") {
				t.Fatalf("wrong read state for %s: %+v", user, item)
			}
		}
	}
	// A database failure during insertion also leaves every item unread.
	if _, err = s.db.Exec("CREATE TRIGGER reject_batch BEFORE INSERT ON notification_reads WHEN NEW.user_id='other' AND NEW.notification_id='b' BEGIN SELECT RAISE(ABORT,'test failure'); END"); err != nil {
		t.Fatal(err)
	}
	if err = s.MarkNotificationsRead(ctx, "other", []string{"a", "b"}); err == nil {
		t.Fatal("expected database failure")
	}
	items, err = s.Notifications(ctx, "other")
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.Read {
			t.Fatal("partial write after database failure")
		}
	}
}
