package storage

import (
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
	"path/filepath"
	"testing"
	"time"
)

func TestStatusCategoryTransactionAndSnapshot(t *testing.T) {
	s := testStore(t)
	ctx := t.Context()
	newNode, err := auth.NewAgents(s).CreateEnrollment(ctx, "admin", "node", "nat")
	if err != nil {
		t.Fatal(err)
	}
	id := newNode.ID
	c := inventory.CategoryCatalog{Revision: 1, Items: []inventory.NodeCategory{{ID: "group", Name: "Group", Kind: "group"}, {ID: "tag", Name: "Tag", Kind: "tag", Shared: true}}}
	if err = s.SaveCategories(ctx, "admin", c); err != nil {
		t.Fatal(err)
	}
	a := inventory.CategoryAssignment{Revision: 2, Nodes: []string{id, "absent"}, Action: "add", Category: "tag"}
	if err = s.AssignCategories(ctx, "admin", a); !errors.Is(err, auth.ErrNotFound) {
		t.Fatal(err)
	}
	n, err := s.Node(ctx, id)
	if err != nil || len(n.Categories) != 0 {
		t.Fatal(n, err)
	}
	a.Nodes = []string{id}
	if err = s.AssignCategories(ctx, "admin", a); err != nil {
		t.Fatal(err)
	}
	a.Action, a.Category, a.Revision = "group", "group", 3
	if err = s.AssignCategories(ctx, "admin", a); err != nil {
		t.Fatal(err)
	}
	c.Revision = 4
	c.Items = []inventory.NodeCategory{c.Items[1]}
	c.Items[0].Name = "Renamed"
	if err = s.SaveCategories(ctx, "admin", c); err != nil {
		t.Fatal(err)
	}
	p := inventory.StatusPublication{Revision: 1, Enabled: true, Nodes: []inventory.PublishedNode{{ID: id, Alias: "Published"}}}
	if err = s.SaveStatusPublication(ctx, "admin", p); err != nil {
		t.Fatal(err)
	}
	p.Revision = 2
	p.Nodes = append(p.Nodes, inventory.PublishedNode{ID: "absent", Alias: "Absent"})
	if err = s.SaveStatusPublication(ctx, "admin", p); !errors.Is(err, auth.ErrNotFound) {
		t.Fatal(err)
	}
	snap := filepath.Join(t.TempDir(), "public.db")
	if err = s.Backup(ctx, snap); err != nil {
		t.Fatal(err)
	}
	if err = ValidateSnapshot(ctx, snap); err != nil {
		t.Fatal(err)
	}
	restored, err := Open(ctx, snap)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	out, err := restored.StatusPublication(ctx)
	if err != nil || !out.Enabled || out.Revision != 2 || len(out.Nodes) != 1 || out.Nodes[0].ID != id {
		t.Fatal(out, err)
	}
	n, err = restored.Node(ctx, id)
	if err != nil || len(n.Categories) != 1 || n.Categories[0].Name != "Renamed" {
		t.Fatal(n, err)
	}
}
func TestLifetimeDeduplicatesOverlappingGenerations(t *testing.T) {
	s := testStore(t)
	ctx := t.Context()
	node, err := auth.NewAgents(s).CreateEnrollment(ctx, "admin", "node", "nat")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	day := now.Truncate(24 * time.Hour)
	insert := func(reg string, start time.Time, rx string) {
		t.Helper()
		_, err := s.db.Exec(`INSERT INTO node_daily_traffic(node_id,registration_at,day_start,day_end,rx_bytes,tx_bytes,sampled_at,revision,quality) VALUES(?,?,?,?,?,1,?,1,0)`, node.ID, reg, start.UnixMilli(), start.Add(24*time.Hour).UnixMilli(), rx, start.UnixMilli())
		if err != nil {
			t.Fatal(err)
		}
	}
	insert("a", day.Add(-24*time.Hour), "20")
	insert("b", day.Add(-24*time.Hour), "9223372036854775807")
	insert("b", day, "5")
	total, err := s.StatusLifetime(ctx, node.ID, now)
	if err != nil || total == nil || total.RX != "9223372036854775812" || total.TX != "2" || !total.Start.Equal(day.Add(-24*time.Hour)) {
		t.Fatal(total, err)
	}
}
