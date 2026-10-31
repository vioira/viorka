package storage

import (
	"context"
	v1 "github.com/vioira/viorka/protocol/v1"
	"path/filepath"
	"testing"
	"time"
)

func TestInventoryPersistenceAndValidation(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "inventory.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	_, err = s.db.Exec(`INSERT INTO nodes(id,name,kind,state,created_at) VALUES('n','node','nat','online',?)`, now())
	if err != nil {
		t.Fatal(err)
	}
	v := v1.NodeInventory{SampledAt: time.Now().UTC(), OSID: "debian", OSName: "Debian GNU/Linux 12", OSVersion: "12", PublicIpv4: "8.8.8.8", PublicIpv6: "2606:4700:4700::1111", Errors: []string{}}
	if err = s.SaveInventory(ctx, "n", v); err != nil {
		t.Fatal(err)
	}
	old := v
	old.SampledAt = old.SampledAt.Add(-time.Nanosecond)
	old.OSName = "old"
	if err = s.SaveInventory(ctx, "n", old); err == nil {
		t.Fatal("late observation overwrote inventory")
	}
	bad := v
	bad.PublicIpv4 = "10.0.0.1"
	if s.SaveInventory(ctx, "n", bad) == nil {
		t.Fatal("private address accepted")
	}
	if err = s.Offline(ctx, "n"); err != nil {
		t.Fatal(err)
	}
	if err = s.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	nodes, err := s.Nodes(ctx, 10, "")
	if err != nil || len(nodes) != 1 || nodes[0].Inventory == nil || nodes[0].Inventory.OSName != v.OSName || nodes[0].Inventory.PublicIpv6 != v.PublicIpv6 {
		t.Fatalf("%+v %v", nodes, err)
	}
	if err = s.SaveInventory(ctx, "n", v); err == nil {
		t.Fatal("offline node update accepted")
	}
}
