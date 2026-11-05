package storage

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/monitoring"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestNodeLocationLifecycle(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "geo.db")
	s, err := Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { s.Close() }()
	if _, err = s.db.Exec(`INSERT INTO nodes(id,name,kind,state,created_at) VALUES('n','node','nat','online',?)`, now()); err != nil {
		t.Fatal(err)
	}
	sampled := time.Now().UTC().Add(-time.Minute)
	report := func(ip4, ip6 string) {
		t.Helper()
		sampled = sampled.Add(time.Second)
		v := v1.NodeInventory{SampledAt: sampled, OSName: "Linux", PublicIpv4: ip4, PublicIpv6: ip6, Errors: []string{}}
		if ip4 == "" {
			v.Errors = append(v.Errors, "public_ipv4_unavailable")
		}
		if ip6 == "" {
			v.Errors = append(v.Errors, "public_ipv6_unavailable")
		}
		if err := s.SaveInventory(ctx, "n", v); err != nil {
			t.Fatal(err)
		}
	}
	us := inventory.Location{CountryCode: "US", Subdivision: "California", City: "Mountain View"}
	jp := inventory.Location{CountryCode: "JP", City: "Tokyo"}
	assertLocation := func(want inventory.Location) {
		t.Helper()
		n, err := s.Node(ctx, "n")
		if err != nil || n.Location != want {
			t.Fatalf("location=%+v err=%v want=%+v", n.Location, err, want)
		}
		ns, err := s.Nodes(ctx, 10, "")
		if err != nil || len(ns) != 1 || ns[0].Location != want {
			t.Fatalf("list=%+v err=%v", ns, err)
		}
	}
	save := func(ip string, l inventory.Location) {
		t.Helper()
		if err := s.SaveLocation(ctx, "n", ip, l); err != nil {
			t.Fatal(err)
		}
	}
	report("8.8.8.8", "2606:4700:4700::1111")
	candidates, err := s.LocationCandidates(ctx, "", 100)
	if err != nil || len(candidates) != 1 || candidates[0].IP != "8.8.8.8" {
		t.Fatalf("%+v %v", candidates, err)
	}
	save("8.8.8.8", us)
	assertLocation(us)
	report("8.8.8.8", "2606:4700:4700::1111")
	assertLocation(us)
	report("1.1.1.1", "2606:4700:4700::1111")
	assertLocation(inventory.Location{})
	save("8.8.8.8", us)
	assertLocation(inventory.Location{})
	save("1.1.1.1", jp)
	assertLocation(jp)
	// Older telemetry must not override the newer inventory address or location.
	hist := historyFixture("n", sampled.Add(-time.Second), 1)
	hist.Addresses = []monitoring.AddressSnapshot{{Family: 4, Address: "8.8.8.8", SampledAt: sampled.Add(-time.Second).UnixMilli()}}
	if err = s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{hist}, time.Now()); err != nil {
		t.Fatal(err)
	}
	assertLocation(jp)
	// New telemetry invalidates and IPv6 becomes the selected public address.
	hist = historyFixture("n", sampled.Add(time.Second), 2)
	hist.Addresses = []monitoring.AddressSnapshot{{Family: 4, Unavailable: true, SampledAt: sampled.Add(time.Second).UnixMilli()}}
	if err = s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{hist}, time.Now()); err != nil {
		t.Fatal(err)
	}
	assertLocation(inventory.Location{})
	save("1.1.1.1", jp)
	assertLocation(inventory.Location{})
	save("2606:4700:4700::1111", us)
	assertLocation(us)
	report("", "")
	assertLocation(inventory.Location{})
	report("", "2606:4700:4700::1111")
	save("2606:4700:4700::1111", us)
	assertLocation(us)
	if err = s.Offline(ctx, "n"); err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = Open(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	assertLocation(us)
	if _, err = s.db.Exec(`DELETE FROM nodes WHERE id='n'`); err != nil {
		t.Fatal(err)
	}
	save("2606:4700:4700::1111", us)
	ns, err := s.Nodes(ctx, 10, "")
	if err != nil || len(ns) != 0 {
		t.Fatalf("deleted node resurrected: %+v %v", ns, err)
	}
}

func TestLocationAddressAndRegionRollbackTogether(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "geo.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	metricNode(t, s, "n")
	at := time.Now().UTC()
	n := historyFixture("n", at, 1)
	n.Addresses = []monitoring.AddressSnapshot{{Family: 4, Address: "8.8.8.8", SampledAt: at.UnixMilli()}}
	if err = s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{n}, at); err != nil {
		t.Fatal(err)
	}
	us := inventory.Location{CountryCode: "US"}
	if err = s.SaveLocation(ctx, "n", "8.8.8.8", us); err != nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`CREATE TRIGGER reject_location BEFORE UPDATE OF geo_country_code ON nodes BEGIN SELECT RAISE(ABORT,'injected failure'); END`); err != nil {
		t.Fatal(err)
	}
	n = historyFixture("n", at.Add(time.Second), 2)
	n.Addresses = []monitoring.AddressSnapshot{{Family: 4, Address: "1.1.1.1", SampledAt: at.Add(time.Second).UnixMilli()}}
	if err = s.SaveTelemetryHistory(ctx, []monitoring.NodeHistory{n}, at.Add(time.Second)); err == nil {
		t.Fatal("expected failure")
	}
	candidates, err := s.LocationCandidates(ctx, "", 100)
	if err != nil || len(candidates) != 1 || candidates[0].IP != "8.8.8.8" {
		t.Fatalf("partial address write: %+v %v", candidates, err)
	}
	node, err := s.Node(ctx, "n")
	if err != nil || node.Location != us {
		t.Fatalf("partial region write: %+v %v", node, err)
	}
}
