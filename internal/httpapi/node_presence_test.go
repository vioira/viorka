package httpapi

import (
	"context"
	"testing"
	"time"
)

func TestDisconnectedNodeWaitsForHeartbeatTimeout(t *testing.T) {
	f := setup(t, "admin")
	enableSettings(t, f)
	node, key := f.enroll()
	c := f.socket(node, f.token(node, key))
	c.CloseNow()
	// Close drains handlers, proving their cleanup does not mark nodes offline.
	f.gate.Close()
	ctx := context.Background()
	n, err := f.store.Node(ctx, node)
	if err != nil || n.State != "online" {
		t.Fatalf("disconnect changed state: %+v %v", n, err)
	}
	last, err := time.Parse(time.RFC3339Nano, n.LastSeenAt)
	if err != nil {
		t.Fatal(err)
	}
	for _, age := range []time.Duration{300 * time.Second, 301 * time.Second} {
		if err := f.store.ExpireOffline(ctx, last.Add(age)); err != nil {
			t.Fatal(err)
		}
		n, err = f.store.Node(ctx, node)
		want := "online"
		count := 0
		if age > 300*time.Second {
			want = "offline"
			count = 1
		}
		if err != nil || n.State != want {
			t.Fatalf("age %s: %+v %v", age, n, err)
		}
		items, err := f.store.Notifications(ctx, f.session.User.ID)
		if err != nil || len(items) != count {
			t.Fatalf("notifications at %s: %d %v", age, len(items), err)
		}
	}
}
