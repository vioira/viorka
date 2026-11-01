package realtime

import (
	"fmt"
	"sync"
	"testing"
)

func TestCoalescingOverflowAndIsolation(t *testing.T) {
	h := New()
	s := h.Subscribe(func(c Change) bool { return c.UserID == "user" })
	defer s.Close()
	h.Publish(Change{Kind: "notifications", UserID: "other"})
	select {
	case <-s.Wake:
		t.Fatal("cross-user event")
	default:
	}
	for range 1000 {
		h.Publish(Change{Kind: "notifications", UserID: "user"})
	}
	<-s.Wake
	changes, reset := s.Drain()
	if reset || len(changes) != 1 {
		t.Fatalf("coalescing: %v %v", changes, reset)
	}
	for i := range 300 {
		h.Publish(Change{Kind: "node", NodeID: fmt.Sprint(i), UserID: "user"})
	}
	<-s.Wake
	changes, reset = s.Drain()
	if !reset || len(changes) != 0 {
		t.Fatal("overflow must force resync, not silently lose state")
	}
	h.Publish(Change{Kind: "node", UserID: "user"})
	<-s.Wake
	changes, reset = s.Drain()
	if reset || len(changes) != 1 {
		t.Fatal("subscription did not recover")
	}
}

func TestConcurrentPublishAndCleanup(t *testing.T) {
	h := New()
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			for range 100 {
				s := h.Subscribe(func(Change) bool { return true })
				h.Publish(Change{Kind: "metrics"})
				s.Drain()
				s.Close()
			}
		})
	}
	wg.Wait()
	if len(h.subs) != 0 {
		t.Fatal("subscriptions leaked")
	}
}
