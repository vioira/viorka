package storage

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"net"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/proxy"
	"github.com/vioira/viorka/internal/subscription"
)

type subscriptionEngine struct {
	ID, NodeID, Name, Version, NodeName string
}

func subscriptionExportAccessTx(ctx context.Context, tx *sql.Tx, actor, node string) error {
	if err := engineAccess(ctx, tx, actor, node, false); err != nil {
		if errors.Is(err, proxy.ErrForbidden) {
			return subscription.ErrForbidden
		}
		return err
	}
	var allowed bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=? AND role='admin' AND disabled=0) OR EXISTS(SELECT 1 FROM engine_node_grants WHERE user_id=? AND node_id=? AND can_export=1)`, actor, actor, node).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return subscription.ErrForbidden
	}
	return nil
}

func subscriptionEngineTx(ctx context.Context, tx *sql.Tx, ref subscription.ServiceRef) (subscriptionEngine, error) {
	var e subscriptionEngine
	err := tx.QueryRowContext(ctx, `SELECT e.id,e.node_id,e.name,coalesce(e.version,''),n.name FROM engines e JOIN nodes n ON n.id=e.node_id WHERE e.id=? AND e.node_id=?`, ref.EngineID, ref.NodeID).Scan(&e.ID, &e.NodeID, &e.Name, &e.Version, &e.NodeName)
	return e, err
}

func subscriptionConnection(e subscriptionEngine, c proxy.Connection) (subscription.ServiceView, subscription.ClientNode, error) {
	var view subscription.ServiceView
	var node subscription.ClientNode
	u, err := url.Parse(c.URL)
	if err != nil || u.Scheme != "vless" || u.User == nil {
		return view, node, subscription.ErrInvalid
	}
	host, rawPort, err := net.SplitHostPort(u.Host)
	if err != nil {
		return view, node, subscription.ErrInvalid
	}
	port, err := strconv.Atoi(rawPort)
	if err != nil || port < 1 || port > 65535 {
		return view, node, subscription.ErrInvalid
	}
	q := u.Query()
	ref := subscription.ServiceRef{NodeID: e.NodeID, EngineID: e.ID, ServiceID: c.ServiceID}
	view = subscription.ServiceView{EntryType: "direct", ServiceRef: ref, NodeName: e.NodeName, Engine: e.Name, Protocol: u.Scheme, ServiceName: c.Name, Status: "available", PublicHost: host, PublicPort: port}
	node = subscription.ClientNode{ServiceRef: ref, Name: e.NodeName + " / " + c.Name, Engine: e.Name, EngineVersion: e.Version, Host: host, Port: port, UUID: u.User.Username(), ServerName: q.Get("sni"), PublicKey: q.Get("pbk"), ShortID: q.Get("sid")}
	view.IncompatibleFormats = []string{}
	for _, format := range []string{subscription.Mihomo, subscription.SingBox, subscription.Loon} {
		if !subscription.Compatible(format, node) {
			view.IncompatibleFormats = append(view.IncompatibleFormats, format)
		}
	}
	if node.UUID == "" || node.ServerName == "" || node.PublicKey == "" || node.ShortID == "" {
		return subscription.ServiceView{}, subscription.ClientNode{}, subscription.ErrInvalid
	}
	return view, node, nil
}

// SubscriptionCandidates counts matching services, with an opaque cursor over
// stable engine and service identities. Only published, authorized connections
// are searched; drafts and credentials are never returned.
func (s *Store) SubscriptionCandidates(ctx context.Context, actor, after string, limit int, query string) ([]subscription.ServiceView, string, error) {
	return s.serviceCandidates(ctx, actor, after, limit, query, false)
}

func (s *Store) RelayLandings(ctx context.Context, actor, after string, limit int, query string) ([]subscription.ServiceView, string, error) {
	return s.serviceCandidates(ctx, actor, after, limit, query, true)
}

func (s *Store) serviceCandidates(ctx context.Context, actor, after string, limit int, query string, landingsOnly bool) ([]subscription.ServiceView, string, error) {
	if len(after) > 512 || limit < 1 || limit > 20 || !validSubscriptionSearch(query) {
		return nil, "", subscription.ErrInvalid
	}
	var startEngine, startService string
	if after != "" {
		raw, err := base64.RawURLEncoding.DecodeString(after)
		var ok bool
		startEngine, startService, ok = strings.Cut(string(raw), "\x00")
		if err != nil || !ok || startEngine == "" || !validSubscriptionSearch(startEngine) || len(startEngine) > 128 || startService == "" || len(startService) > 64 || !validSubscriptionSearch(startService) {
			return nil, "", subscription.ErrInvalid
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, "", err
	}
	defer tx.Rollback()
	admin, err := subscriptionActor(ctx, tx, actor, false)
	if err != nil {
		return nil, "", err
	}
	items := []subscription.ServiceView{}
	keyword := strings.ToLower(strings.TrimSpace(query))
	first := true
	engineCursor := startEngine
	eligible := "e.name IN ('sing-box','xray','realm')"
	if landingsOnly {
		eligible = "e.name IN ('sing-box','xray') AND " + runningRelayLanding
	}
	for {
		// The first batch revisits the cursor's engine for its remaining services.
		rows, err := tx.QueryContext(ctx, `SELECT e.id,e.node_id,e.name,coalesce(e.version,''),n.name FROM engines e JOIN nodes n ON n.id=e.node_id WHERE (e.id>? OR (?=1 AND e.id=?)) AND `+eligible+` AND e.ownership='managed' AND (?=1 OR EXISTS(SELECT 1 FROM engine_node_grants g WHERE g.node_id=e.node_id AND g.user_id=? AND g.can_export=1)) ORDER BY e.id LIMIT 20`, engineCursor, first, engineCursor, admin, actor)
		if err != nil {
			return nil, "", err
		}
		engines := []subscriptionEngine{}
		for rows.Next() {
			var e subscriptionEngine
			if err = rows.Scan(&e.ID, &e.NodeID, &e.Name, &e.Version, &e.NodeName); err != nil {
				break
			}
			engines = append(engines, e)
		}
		if err == nil {
			err = rows.Err()
		}
		rows.Close()
		if err != nil {
			return nil, "", err
		}
		for _, e := range engines {
			views, err := s.subscriptionEngineCandidates(ctx, tx, actor, e)
			if errors.Is(err, proxy.ErrConflict) || errors.Is(err, proxy.ErrInvalid) || errors.Is(err, auth.ErrNotFound) {
				continue
			}
			if err != nil {
				return nil, "", err
			}
			sort.Slice(views, func(i, j int) bool { return views[i].ServiceID < views[j].ServiceID })
			for _, view := range views {
				if e.ID == startEngine && view.ServiceID <= startService {
					continue
				}
				searchable := strings.Join([]string{e.NodeName, e.NodeID, e.Name, view.ServiceName, view.ServiceID, view.Protocol}, " ")
				if !strings.Contains(strings.ToLower(searchable), keyword) {
					continue
				}
				if len(items) == limit {
					last := items[len(items)-1]
					next := base64.RawURLEncoding.EncodeToString([]byte(last.EngineID + "\x00" + last.ServiceID))
					return items, next, tx.Commit()
				}
				items = append(items, view)
			}
		}
		if len(engines) < 20 {
			break
		}
		engineCursor = engines[len(engines)-1].ID
		first = false
	}
	return items, "", tx.Commit()
}

// subscriptionServiceTx returns an explicit state for previously selected
// services. It never substitutes an unpublished draft or a historic credential.
func (s *Store) subscriptionServiceTx(ctx context.Context, tx *sql.Tx, owner string, ref subscription.ServiceRef, invalidated bool) (subscription.ServiceView, *subscription.ClientNode, error) {
	view := subscription.ServiceView{EntryType: "direct", ServiceRef: ref, Status: "unavailable", IncompatibleFormats: []string{}}

	e, err := subscriptionEngineTx(ctx, tx, ref)
	if errors.Is(err, sql.ErrNoRows) {
		view.Status, view.Reason = "invalid", "service_removed"
		return view, nil, nil
	}
	if err != nil {
		return view, nil, err
	}
	if invalidated {
		if e.Name == "realm" {
			view.EntryType = "relay"
		}
		view.Status, view.Reason = "invalid", "service_removed"
		return view, nil, nil
	}
	if e.Name == "realm" {
		return s.relaySubscriptionTx(ctx, tx, owner, ref)
	}
	view.NodeName, view.Engine = e.NodeName, e.Name
	if err = subscriptionExportAccessTx(ctx, tx, owner, e.NodeID); errors.Is(err, subscription.ErrForbidden) {
		view.Status, view.Reason = "forbidden", "permission_lost"
		return view, nil, nil
	} else if err != nil {
		return view, nil, err
	}
	var recovery string
	err = tx.QueryRowContext(ctx, `SELECT state FROM subscription_restore_engines WHERE engine_id=?`, e.ID).Scan(&recovery)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return view, nil, err
	}
	if err == nil && recovery != "matched" {
		view.Status, view.Reason = "pending", "restore_verification_required"
		return view, nil, nil
	}
	connections, err := s.engineConnectionsTx(ctx, tx, owner, e.ID)
	if errors.Is(err, proxy.ErrConflict) || errors.Is(err, proxy.ErrInvalid) || errors.Is(err, auth.ErrNotFound) {
		view.Reason = "service_unavailable"
		return view, nil, nil
	}
	if err != nil {
		return view, nil, err
	}
	for _, c := range connections {
		if c.ServiceID == ref.ServiceID {
			view, node, err := subscriptionConnection(e, c)
			if err != nil {
				return subscription.ServiceView{}, nil, err
			}
			return view, &node, nil
		}
	}
	if recovery != "" {
		view.Status, view.Reason = "pending", "restore_endpoint_confirmation_required"
	} else {
		view.Reason = "service_unavailable"
	}
	return view, nil, nil
}
