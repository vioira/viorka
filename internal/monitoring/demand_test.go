package monitoring

import (
	"fmt"
	"testing"
	"time"
)

func TestDemandReferencesGraceAndScope(t *testing.T) {
	now := time.Now()
	var d *Demands
	wakes := 0
	d = NewDemands(func(node string) { _ = d.State(node); wakes++ }) // callback outside lock
	a, err := d.Subscribe([]string{"a", "b", "a"}, now)
	if err != nil {
		t.Fatal(err)
	}
	b, err := d.Subscribe([]string{"a"}, now)
	if err != nil {
		t.Fatal(err)
	}
	if d.State("a").References != 2 || d.State("b").References != 1 {
		t.Fatal("reference count")
	}
	a.Close(now)
	a.Close(now)
	if d.State("a").References != 1 || !d.State("b").GraceUntil.Equal(now.Add(15*time.Second)) {
		t.Fatal("close/idempotency")
	}
	if err = b.Update([]string{"b"}, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if d.State("b").References != 1 || !d.State("b").GraceUntil.IsZero() {
		t.Fatal("new viewer did not cancel grace")
	}
	if d.State("a").References != 0 || !d.State("a").GraceUntil.Equal(now.Add(16*time.Second)) {
		t.Fatal("scope removal")
	}
	b.Close(now.Add(2 * time.Second))
	if err = b.Update([]string{"a"}, now); err == nil {
		t.Fatal("closed subscription reused")
	}
	if wakes != 8 {
		t.Fatalf("unexpected changes %d", wakes)
	}
}
func TestDemandBudgetsAndAtomicFailure(t *testing.T) {
	now := time.Now()
	d := NewDemands(nil)
	nodes := make([]string, MaxNodes)
	for i := range nodes {
		nodes[i] = fmt.Sprintf("node-%d", i)
	}
	sub, err := d.Subscribe(nodes, now)
	if err != nil {
		t.Fatal(err)
	}
	if err = sub.Update([]string{"extra"}, now); err == nil {
		t.Fatal("node bound ignored")
	}
	if d.State(nodes[0]).References != 1 || d.State("extra").References != 0 {
		t.Fatal("failed update changed references")
	}
	sub.Close(now)
	after, err := d.Subscribe([]string{"extra"}, now.Add(DemandGrace))
	if err != nil {
		t.Fatal("expired grace not reclaimed", err)
	}
	after.Close(now.Add(DemandGrace))
	subscriptions := make([]*DemandSubscription, MaxDemandSubscriptions)
	for i := range subscriptions {
		sub, err := d.Subscribe(nil, now.Add(time.Minute))
		if err != nil {
			t.Fatal(err)
		}
		subscriptions[i] = sub
	}
	if _, err = d.Subscribe(nil, now); err == nil {
		t.Fatal("subscription bound ignored")
	}
	for _, sub := range subscriptions {
		sub.Close(now)
	}
	if d.subscriptions != 0 {
		t.Fatal("subscription leak")
	}
}
