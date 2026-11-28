package storage

import (
	"context"
	"database/sql"
	"errors"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/subscription"
)

func (s *Store) relaySubscriptionTx(ctx context.Context, tx *sql.Tx, owner string, ref subscription.ServiceRef) (subscription.ServiceView, *subscription.ClientNode, error) {
	view := subscription.ServiceView{ServiceRef: ref, Engine: "realm", EntryType: "relay", Status: "unavailable", IncompatibleFormats: []string{}}
	var matches bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM relay_routes r JOIN engines e ON e.id=r.engine_id WHERE r.id=? AND e.id=? AND e.node_id=? AND r.deleted=0)`, ref.ServiceID, ref.EngineID, ref.NodeID).Scan(&matches); err != nil {
		return view, nil, err
	}
	if !matches {
		view.Status, view.Reason = "invalid", "service_removed"
		return view, nil, nil
	}
	if err := subscriptionExportAccessTx(ctx, tx, owner, ref.NodeID); err != nil {
		if errors.Is(err, subscription.ErrForbidden) {
			view.Status, view.Reason = "forbidden", "permission_lost"
			return view, nil, nil
		}
		return view, nil, err
	}
	r, node, err := s.relayDetailTx(ctx, tx, owner, ref.ServiceID, true)
	if errors.Is(err, subscription.ErrForbidden) || errors.Is(err, proxy.ErrForbidden) {
		view.Status, view.Reason = "forbidden", "permission_lost"
		return view, nil, nil
	}
	if errors.Is(err, auth.ErrNotFound) {
		view.Status, view.Reason = "invalid", "service_removed"
		return view, nil, nil
	}
	if err != nil {
		return view, nil, err
	}
	path := r.Draft
	if r.Published != nil {
		path = *r.Published
	}
	if r.ServingPath != nil {
		path = *r.ServingPath
	}
	view.NodeName, view.ServiceName, view.LandingName, view.Protocol = r.EntryName, path.Name, path.LandingName, "vless"
	view.PublicHost, view.PublicPort = path.Public.Host, path.Public.Port
	if node == nil {
		view.Reason = r.Reason
		return view, nil, nil
	}
	view.Status = "available"
	view.VerifiedAt = r.VerifiedAt
	for _, format := range []string{subscription.Mihomo, subscription.SingBox, subscription.Loon} {
		if !subscription.Compatible(format, *node) {
			view.IncompatibleFormats = append(view.IncompatibleFormats, format)
		}
	}
	return view, node, nil
}

func (s *Store) subscriptionEngineCandidates(ctx context.Context, tx *sql.Tx, owner string, e subscriptionEngine) ([]subscription.ServiceView, error) {
	views := []subscription.ServiceView{}
	if e.Name != "realm" {
		connections, err := s.engineConnectionsTx(ctx, tx, owner, e.ID)
		if err != nil {
			return nil, err
		}
		for _, c := range connections {
			view, _, err := subscriptionConnection(e, c)
			if err != nil {
				return nil, err
			}
			views = append(views, view)
		}
		return views, nil
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM relay_routes WHERE engine_id=? AND target_revision>0 AND stopped_at='' AND deleted=0 ORDER BY id LIMIT 32`, e.ID)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		view, _, err := s.relaySubscriptionTx(ctx, tx, owner, subscription.ServiceRef{NodeID: e.NodeID, EngineID: e.ID, ServiceID: id})
		if err != nil {
			return nil, err
		}
		if view.Status == "available" {
			views = append(views, view)
		}
	}
	return views, nil
}
