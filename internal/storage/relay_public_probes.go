package storage

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/netip"
	"strings"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/realtime"
	"github.com/vioira/viorka/internal/relayprobe"
	"github.com/vioira/viorka/internal/subscription"
)

func readPublicProbe(ctx context.Context, tx *sql.Tx, id string, revision int64, epoch string) (*proxy.RelayPublicProbe, error) {
	var q proxy.RelayPublicProbe
	err := tx.QueryRowContext(ctx, `SELECT check_id,revision,host,port,state,source,detail,checked_at,address FROM relay_public_probes WHERE route_id=? AND revision=? AND epoch=?`, id, revision, epoch).Scan(&q.ID, &q.Revision, &q.Endpoint.Host, &q.Endpoint.Port, &q.State, &q.Source, &q.Detail, &q.At, &q.Address)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return &q, err
}

func (s *Store) RetestRelayPublic(ctx context.Context, actor, id string, input proxy.RelayRetest) (proxy.RelayPublicProbe, error) {
	var empty proxy.RelayPublicProbe
	if input.Revision < 1 || !proxy.ValidID(input.CheckID) {
		return empty, proxy.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return empty, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `UPDATE relay_routes SET id=id WHERE id=?`, id); err != nil {
		return empty, err
	}
	r, _, err := s.relayDetailTx(ctx, tx, actor, id, false)
	if err != nil {
		return empty, err
	}
	if !r.CanManage || r.CleanupOnly {
		return empty, proxy.ErrForbidden
	}
	q := r.PublicProbe
	if !r.CanTestPublic() || r.TargetRevision != input.Revision || q == nil || q.ID != input.CheckID {
		return empty, proxy.ErrRelayRevision
	}
	if q.State == "checking" || q.State == "queued" {
		return *q, tx.Commit()
	}
	q.ID, q.State, q.Source, q.Detail, q.At, q.Address = auth.Random(), "queued", "", "", "", ""
	if _, err = tx.ExecContext(ctx, `UPDATE relay_public_probes SET check_id=?,requested_by=?,state='queued',source='',detail='',checked_at='',address='',due_at=?,lease_id='' WHERE route_id=? AND revision=? AND check_id=?`, q.ID, actor, now(), id, input.Revision, input.CheckID); err != nil {
		return empty, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE relay_routes SET confirmed_revision=0 WHERE id=?`, id); err != nil {
		return empty, err
	}
	if err = audit(ctx, tx, actor, "relay.public.retest", "relay", id); err != nil {
		return empty, err
	}
	return *q, s.commitChanges(tx, realtime.Change{Kind: "engines", NodeID: r.EntryNode, EngineID: r.Draft.EngineID})
}

type publicProbeJob struct {
	route, actor, epoch, lease, checkID, node, engine string
	revision                                          int64
	target                                            relayprobe.Target
}

// An editable hostname or public port alone is insufficient authority to dial.
// For direct ingress use node-owned addresses and the applied listener port.
// Shared or translated ports also need an allocation or administrator review.
func publicProbeTarget(ctx context.Context, tx *sql.Tx, route, node string, revision int64, p proxy.RelayPath) (relayprobe.Target, error) {
	target := relayprobe.Target{Endpoint: p.Public}
	var kind, v4, v6 string
	var bound, reviewed bool
	err := tx.QueryRowContext(ctx, `SELECT n.kind,coalesce(json_extract(n.inventory_json,'$.public_ipv4'),''),coalesce(json_extract(n.inventory_json,'$.public_ipv6'),''),
 p.admin_reviewed_port,EXISTS(SELECT 1 FROM relay_public_bindings WHERE route_id=? AND host=? AND port=?)
 FROM relay_publications p JOIN nodes n ON n.id=? WHERE p.route_id=? AND p.revision=?`, route, p.Public.Host, p.Public.Port, node, route, revision).Scan(&kind, &v4, &v6, &reviewed, &bound)
	if err != nil || !bound {
		return target, err
	}
	// A deployment administrator can approve a manually entered NAT port in
	// the publication review. Only node-reported IPs qualify, and an existing
	// allocation (including a retired one) takes precedence over that review.
	if reviewed || kind == "vps" && p.Public.Port == p.Listen.Port {
		for _, raw := range []string{v4, v6} {
			ip, err := netip.ParseAddr(raw)
			if err != nil {
				continue
			}
			var allocated bool
			if err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM port_allocations WHERE transport='tcp' AND public_port=? AND lower(public_host) IN (?,?))`, p.Public.Port, ip.Unmap().String(), p.Public.Host).Scan(&allocated); err != nil {
				return target, err
			}
			if !allocated {
				target.Addresses = append(target.Addresses, ip.Unmap())
			}
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT a.public_host,a.private_host FROM port_allocations a
 WHERE a.node_id=? AND a.public_port=? AND a.private_port=? AND a.transport='tcp' AND a.state IN ('active','assigned')
 AND NOT EXISTS (SELECT 1 FROM port_allocations other WHERE other.node_id!=a.node_id AND other.transport='tcp'
  AND other.state IN ('active','assigned') AND other.public_port=a.public_port AND lower(other.public_host)=lower(a.public_host))`, node, p.Public.Port, p.Listen.Port)
	if err != nil {
		return target, err
	}
	defer rows.Close()
	listener, err := netip.ParseAddr(p.Listen.Host)
	if err != nil {
		return target, err
	}
	if !listener.IsUnspecified() {
		target.EntryAddresses = append(target.EntryAddresses, listener.Unmap())
	}
	for rows.Next() {
		var host, private string
		if err = rows.Scan(&host, &private); err != nil {
			return target, err
		}
		mapped, err := netip.ParseAddr(private)
		if err != nil || (listener != mapped.Unmap() && !(listener.IsUnspecified() && (listener.Is6() || mapped.Unmap().Is4()))) {
			continue
		}
		target.EntryAddresses = append(target.EntryAddresses, mapped.Unmap())
		if ip, err := netip.ParseAddr(host); err == nil {
			target.Addresses = append(target.Addresses, ip.Unmap())
		} else if strings.EqualFold(host, p.Public.Host) {
			target.AllocatedHost = true
		}
	}
	return target, rows.Err()
}

func (s *Store) claimPublicProbe(ctx context.Context) (*publicProbeJob, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	j := publicProbeJob{lease: auth.Random()}
	err = tx.QueryRowContext(ctx, `SELECT q.route_id,q.revision,q.epoch,q.check_id,q.requested_by,e.node_id,e.id
 FROM relay_public_probes q JOIN relay_routes r ON r.id=q.route_id AND r.target_revision=q.revision AND r.verify_after=q.epoch
 JOIN engines e ON e.id=r.engine_id JOIN relay_publications p ON p.route_id=r.id AND p.revision=q.revision JOIN tasks t ON t.id=p.task_id
 WHERE q.state IN ('queued','checking') AND q.due_at<=? AND r.deleted=0 AND r.stopped_at='' AND p.operation='publish'
 AND e.ownership='managed' AND e.name='realm' AND t.state='succeeded' AND json_extract(t.result_json,'$.engine.status')='running'
 AND e.observed_revision>=q.revision AND e.last_absent_revision<q.revision AND e.status='running'
 ORDER BY q.due_at,q.route_id LIMIT 1`, now()).Scan(&j.route, &j.revision, &j.epoch, &j.checkID, &j.actor, &j.node, &j.engine)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE relay_routes SET id=id WHERE id=?`, j.route); err != nil {
		return nil, err
	}
	res, err := tx.ExecContext(ctx, `UPDATE relay_public_probes SET state='checking',lease_id=?,due_at=? WHERE route_id=? AND revision=? AND epoch=? AND check_id=? AND state IN ('queued','checking') AND due_at<=?`, j.lease, at(time.Now().Add(30*time.Second)), j.route, j.revision, j.epoch, j.checkID, now())
	if err != nil {
		return nil, err
	}
	n, err := res.RowsAffected()
	if err != nil || n == 0 {
		return nil, err
	}
	r, _, err := s.relayDetailTx(ctx, tx, j.actor, j.route, false)
	if publicProbeDenied(r, err) {
		return nil, s.storePublicResult(ctx, tx, j, relayprobe.Result{State: "unavailable", Detail: "permission_lost"})
	}
	if err != nil {
		return nil, err
	}
	if r.TargetRevision != j.revision || !r.CanTestPublic() || r.PublicProbe == nil || r.PublicProbe.ID != j.checkID {
		// A landing or a restored engine may still be awaiting reconciliation.
		_, err = tx.ExecContext(ctx, `UPDATE relay_public_probes SET state='queued',lease_id='' WHERE lease_id=? AND route_id=?`, j.lease, j.route)
		if err != nil {
			return nil, err
		}
		return nil, tx.Commit()
	}
	j.target, err = publicProbeTarget(ctx, tx, r.ID, r.EntryNode, r.TargetRevision, *r.Published)
	if err != nil {
		return nil, err
	}
	return &j, s.commitChanges(tx, realtime.Change{Kind: "engines", NodeID: j.node, EngineID: j.engine})
}

func publicProbeDenied(r proxy.RelayRoute, err error) bool {
	return errors.Is(err, proxy.ErrForbidden) || errors.Is(err, subscription.ErrForbidden) || err == nil && (!r.CanManage || r.CleanupOnly)
}

func (s *Store) finishPublicProbe(ctx context.Context, j publicProbeJob, result relayprobe.Result) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Serialize with publish, withdrawal and retest. A duplicate, expired lease
	// or pre-restore result never changes confirmed_revision.
	if _, err = tx.ExecContext(ctx, `UPDATE relay_routes SET id=id WHERE id=?`, j.route); err != nil {
		return err
	}
	var live bool
	err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM relay_public_probes q JOIN relay_routes r ON r.id=q.route_id AND r.target_revision=q.revision AND r.verify_after=q.epoch
 WHERE r.id=? AND r.deleted=0 AND r.stopped_at='' AND q.revision=? AND q.epoch=? AND q.state='checking' AND q.check_id=? AND q.lease_id=? AND q.due_at>? AND q.host=? AND q.port=?)`, j.route, j.revision, j.epoch, j.checkID, j.lease, now(), j.target.Endpoint.Host, j.target.Endpoint.Port).Scan(&live)
	if err != nil || !live {
		return err
	}
	r, _, err := s.relayDetailTx(ctx, tx, j.actor, j.route, false)
	switch {
	case publicProbeDenied(r, err):
		result.State, result.Detail = "unavailable", "permission_lost"
	case err != nil:
		return err
	case !r.CanTestPublic():
		return nil // leave the lease recoverable
	case result.State == "passed":
		target, err := publicProbeTarget(ctx, tx, r.ID, r.EntryNode, r.TargetRevision, *r.Published)
		if err != nil {
			return err
		}
		if !target.Allows(result.IP) || target.Endpoint != j.target.Endpoint {
			result.State, result.Detail = "failed", "target_not_authorized"
		}
	}
	return s.storePublicResult(ctx, tx, j, result)
}
func (s *Store) storePublicResult(ctx context.Context, tx *sql.Tx, j publicProbeJob, result relayprobe.Result) error {
	address := ""
	if result.State == "passed" {
		address = result.IP.String()
	}
	if _, err := tx.ExecContext(ctx, `UPDATE relay_public_probes SET state=?,detail=?,source=?,address=?,checked_at=?,lease_id='' WHERE route_id=? AND revision=? AND epoch=? AND lease_id=?`, result.State, result.Detail, result.Source, address, now(), j.route, j.revision, j.epoch, j.lease); err != nil {
		return err
	}
	var confirmed int64
	if result.State == "passed" {
		confirmed = j.revision
	}
	if _, err := tx.ExecContext(ctx, `UPDATE relay_routes SET confirmed_revision=? WHERE id=? AND target_revision=? AND verify_after=? AND stopped_at='' AND deleted=0`, confirmed, j.route, j.revision, j.epoch); err != nil {
		return err
	}
	return s.commitChanges(tx, realtime.Change{Kind: "engines", NodeID: j.node, EngineID: j.engine})
}

func (s *Store) RunRelayPublicProbes(ctx context.Context, checker *relayprobe.Checker) {
	// A single worker bounds outbound concurrency and holds no SQL connection
	// across DNS or TCP. The durable lease makes interruption recoverable.
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for ctx.Err() == nil {
		work, cancel := context.WithTimeout(ctx, 5*time.Second)
		j, err := s.claimPublicProbe(work)
		cancel()
		if err == nil && j != nil {
			result := checker.Check(ctx, j.target)
			if ctx.Err() != nil {
				return
			}
			work, cancel = context.WithTimeout(ctx, 5*time.Second)
			err = s.finishPublicProbe(work, *j, result)
			cancel()
		}
		if err != nil && ctx.Err() == nil {
			slog.Error("relay public probe storage failed", "error", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
