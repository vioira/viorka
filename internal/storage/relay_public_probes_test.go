package storage

import (
	"errors"
	"net/netip"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/relayprobe"
	"github.com/vioira/viorka/internal/subscription"
)

func TestRelayPublicProbeSubscriptionGate(t *testing.T) {
	ctx := t.Context()
	s, r, edit := relayFixture(t)
	task, err := s.PublishRelay(ctx, "admin", r.ID, reviewRelay(r, "publish"))
	if err != nil {
		t.Fatal(err)
	}
	claim := func() *publicProbeJob {
		t.Helper()
		j, err := s.claimPublicProbe(ctx)
		if err != nil {
			t.Fatal(err)
		}
		return j
	}
	if j := claim(); j != nil {
		t.Fatal("work claimed before running apply")
	}
	replyRelay(t, s, task.ID, 1, "running")
	get := func() proxy.RelayRoute {
		t.Helper()
		r, err := s.RelayRoute(ctx, "admin", r.ID)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}
	r = get()
	if r.ServingRevision != 0 || r.Reason != "awaiting_public" {
		t.Fatal("route became eligible before the public TCP check", r)
	}
	passPublicProbe(t, s, r)
	edit.Services = []subscription.ServiceRef{{NodeID: "other", EngineID: "realm", ServiceID: r.ID}}
	_, token, err := s.SaveSubscription(ctx, "admin", "", edit)
	if err != nil {
		t.Fatal(err)
	}
	eligible := func(want bool) {
		t.Helper()
		_, err := s.FetchSubscription(ctx, token, "client", "mihomo")
		if want && err != nil || !want && !errors.Is(err, subscription.ErrNoServices) {
			t.Fatalf("eligible=%v err=%v", want, err)
		}
		list, _, err := s.SubscriptionCandidates(ctx, "admin", "", 20, "香港")
		if err != nil || (len(list) == 1) != want {
			t.Fatal("picker", list, err)
		}
	}
	recheck := func() proxy.RelayPublicProbe {
		t.Helper()
		q := get().PublicProbe
		next, err := s.RetestRelayPublic(ctx, "admin", r.ID, proxy.RelayRetest{Revision: q.Revision, CheckID: q.ID})
		if err != nil || next.State != "queued" || next.ID == q.ID {
			t.Fatal(next, err)
		}
		eligible(false)
		return next
	}
	eligible(true)
	recheck()
	j := claim()
	if j == nil || claim() != nil || get().PublicProbe.State != "checking" {
		t.Fatal("missing or duplicated claim")
	}
	pass := relayprobe.Result{State: "passed", Source: "external", IP: netip.MustParseAddr("93.184.216.34")}
	fail := relayprobe.Result{State: "failed", Detail: "refused", Source: "panel"}
	if err = s.finishPublicProbe(ctx, *j, fail); err != nil {
		t.Fatal(err)
	}
	if err = s.finishPublicProbe(ctx, *j, pass); err != nil || get().Reason != "public_failed" || get().PublicProbe.Detail != "refused" {
		t.Fatal("duplicate replaced failure", err)
	}
	eligible(false)
	recheck()
	old := claim()
	if old == nil {
		t.Fatal("missing recheck")
	}
	if _, err = s.db.Exec(`UPDATE relay_public_probes SET due_at=? WHERE lease_id=?`, at(time.Now().Add(-time.Minute)), old.lease); err != nil {
		t.Fatal(err)
	}
	next := claim()
	if next == nil || next.checkID != old.checkID || next.lease == old.lease {
		t.Fatal("abandoned lease not reclaimed")
	}
	if err = s.finishPublicProbe(ctx, *old, pass); err != nil {
		t.Fatal(err)
	}
	eligible(false)
	checker, err := relayprobe.New("", "")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.finishPublicProbe(ctx, *next, checker.Check(ctx, next.target)); err != nil || get().Reason != "probe_unavailable" {
		t.Fatal(err)
	}
	eligible(false)
	recheck()
	passPublicProbe(t, s, get())
	eligible(true)
	recheck()
	late := claim()
	if late == nil {
		t.Fatal("missing in-flight job")
	}
	if _, err = s.WithdrawRelay(ctx, "admin", r.ID, proxy.RelayAction{Version: r.Draft.Version, RequestKey: "stop"}); err != nil {
		t.Fatal(err)
	}
	if err = s.finishPublicProbe(ctx, *late, pass); err != nil {
		t.Fatal(err)
	}
	eligible(false)
}

func TestRelayPublicProbeRevokedMappingAndGrants(t *testing.T) {
	s, r, _ := relayFixture(t)
	ctx := t.Context()
	for _, node := range []string{"other", "node"} {
		if err := s.SetEngineGrant(ctx, "admin", node, proxy.Grant{UserID: "operator", CanManage: node == "other", CanExport: true}); err != nil {
			t.Fatal(err)
		}
	}
	task, err := s.PublishRelay(ctx, "operator", r.ID, reviewRelay(r, "publish"))
	if err != nil {
		t.Fatal(err)
	}
	replyRelay(t, s, task.ID, 1, "running")
	j, err := s.claimPublicProbe(ctx)
	if err != nil || j == nil {
		t.Fatal(err)
	}
	if _, err = s.db.Exec(`UPDATE port_allocations SET state='inactive' WHERE id='fixture-public'`); err != nil {
		t.Fatal(err)
	}
	if err = s.finishPublicProbe(ctx, *j, relayprobe.Result{State: "passed", IP: netip.MustParseAddr("93.184.216.34")}); err != nil {
		t.Fatal(err)
	}
	r, err = s.RelayRoute(ctx, "admin", r.ID)
	if err != nil || r.Reason != "public_failed" || r.PublicProbe.Detail != "target_not_authorized" {
		t.Fatal(r, err)
	}
	if _, err = s.RetestRelayPublic(ctx, "operator", r.ID, proxy.RelayRetest{Revision: r.TargetRevision, CheckID: r.PublicProbe.ID}); err != nil {
		t.Fatal(err)
	}
	if err = s.SetEngineGrant(ctx, "admin", "other", proxy.Grant{UserID: "operator"}); err != nil {
		t.Fatal(err)
	}
	if j, err = s.claimPublicProbe(ctx); err != nil || j != nil {
		t.Fatal("revoked manager issued probe", j, err)
	}
	r, err = s.RelayRoute(ctx, "admin", r.ID)
	if err != nil || r.Reason != "probe_unavailable" || r.PublicProbe.Detail != "permission_lost" {
		t.Fatal(r, err)
	}
}

func TestRelayReviewedNATPortAndRevokedAssignment(t *testing.T) {
	ctx := t.Context()
	for _, actor := range []string{"admin", "operator"} {
		t.Run(actor, func(t *testing.T) {
			s, r, _ := relayFixture(t)
			if _, err := s.db.Exec(`UPDATE nodes SET kind='nat',inventory_json='{"public_ipv4":"93.184.216.34"}' WHERE id='other'`); err != nil {
				t.Fatal(err)
			}
			if _, err := s.db.Exec(`DELETE FROM port_allocations WHERE id='fixture-public'`); err != nil {
				t.Fatal(err)
			}
			for _, node := range []string{"other", "node"} {
				if err := s.SetEngineGrant(ctx, "admin", node, proxy.Grant{UserID: "operator", CanManage: node == "other", CanExport: true}); err != nil {
					t.Fatal(err)
				}
			}
			task, err := s.PublishRelay(ctx, actor, r.ID, reviewRelay(r, "nat"))
			if err != nil {
				t.Fatal(err)
			}
			replyRelay(t, s, task.ID, 1, "running")
			j, err := s.claimPublicProbe(ctx)
			if err != nil || j == nil {
				t.Fatal(err)
			}
			ip := netip.MustParseAddr("93.184.216.34")
			if j.target.Allows(ip) != (actor == "admin") || j.target.Endpoint.Port != 30443 || j.target.Allows(netip.MustParseAddr("8.8.8.8")) {
				t.Fatal("wrong manual NAT authorization", j.target)
			}
			if actor == "operator" {
				return
			}
			if err = s.finishPublicProbe(ctx, *j, relayprobe.Result{State: "passed", Source: "panel", IP: ip}); err != nil {
				t.Fatal(err)
			}
			r, err = s.RelayRoute(ctx, "admin", r.ID)
			if err != nil || r.ServingRevision == 0 {
				t.Fatal(r, err)
			}
			if _, err = s.db.Exec(`INSERT INTO port_allocations(id,node_id,public_host,public_port,private_host,private_port,transport,owner,created_at) VALUES('another','node','93.184.216.34',30443,'10.0.0.5',10080,'tcp','provider',?)`, now()); err != nil {
				t.Fatal(err)
			}
			r, err = s.RelayRoute(ctx, "admin", r.ID)
			if err != nil || r.ServingRevision != 0 || r.Reason != "public_mapping_changed" {
				t.Fatal("reassigned NAT port remained eligible", r, err)
			}
			if _, err = s.db.Exec(`INSERT INTO port_allocations(id,node_id,public_host,public_port,private_host,private_port,transport,owner,created_at) VALUES('ambiguous','other','93.184.216.34',30443,'10.0.0.8',10043,'tcp','provider',?)`, now()); err != nil {
				t.Fatal(err)
			}
			r, err = s.RelayRoute(ctx, "admin", r.ID)
			if err != nil || r.ServingRevision != 0 {
				t.Fatal("ambiguous TCP allocation was authorized", r, err)
			}

		})
	}
}
