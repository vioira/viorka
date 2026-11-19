package httpapi

import (
	"context"
	"testing"
	"time"

	"github.com/coder/websocket"
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
	for _, age := range []time.Duration{60 * time.Second, 61 * time.Second, 361 * time.Second} {
		if err := f.store.ExpireOffline(ctx, last.Add(age)); err != nil {
			t.Fatal(err)
		}
		n, err = f.store.Node(ctx, node)
		want := "online"
		count := 0
		if age > 60*time.Second {
			want = "offline"
		}
		if age >= 361*time.Second {
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

func TestNodePresenceAfterPeerClose(t *testing.T) {
	for _, tc := range []struct {
		code websocket.StatusCode
		want string
	}{
		{4001, "offline"}, {websocket.StatusNormalClosure, "online"},
	} {
		f := setup(t, "admin")
		enableSettings(t, f)
		node, key := f.enroll()
		c := f.socket(node, f.token(node, key))
		if err := c.Close(tc.code, "agent stopping"); err != nil {
			t.Fatal(err)
		}
		f.gate.Close()
		n, err := f.store.Node(context.Background(), node)
		if err != nil || n.State != tc.want {
			t.Fatalf("close %d: state %s, error %v", tc.code, n.State, err)
		}
		items, err := f.store.Notifications(context.Background(), f.session.User.ID)
		if err != nil || len(items) != 0 {
			t.Fatalf("unexpected outage notification: %v %v", items, err)
		}
	}
}
