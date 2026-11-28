package storage

import (
	"context"
	"database/sql"
	"slices"
	"strings"

	"github.com/vioira/viorka/internal/proxy"
)

type serviceNodeGrant struct {
	proxy.ServiceNode
	export bool
}

func serviceNodes(ctx context.Context, tx *sql.Tx, actor string, result *proxy.ServiceList) (map[string]serviceNodeGrant, error) {
	rows, err := tx.QueryContext(ctx, `SELECT n.id,n.name,n.state,coalesce(n.last_seen_at,''),
		u.role='admin' OR g.user_id IS NOT NULL,
		u.role='admin' OR (u.role='operator' AND coalesce(g.can_manage,0)=1),
		u.role='admin' OR coalesce(g.can_export,0)=1
		FROM nodes n JOIN users u ON u.id=? AND u.disabled=0
		LEFT JOIN engine_node_grants g ON g.node_id=n.id AND g.user_id=u.id ORDER BY n.id`, actor)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	nodes := map[string]serviceNodeGrant{}
	for rows.Next() {
		var n serviceNodeGrant
		var readable bool
		if err := rows.Scan(&n.ID, &n.Name, &n.State, &n.LastSeenAt, &readable, &n.CanManage, &n.export); err != nil {
			return nil, err
		}
		if !readable {
			result.Restricted = true
			continue
		}
		nodes[n.ID] = n
		result.Nodes = append(result.Nodes, n.ServiceNode)
	}
	return nodes, rows.Err()
}

type serviceRelayRef struct{ id, search string }

func serviceRelayIndex(ctx context.Context, tx *sql.Tx, actor string, nodes map[string]serviceNodeGrant) (map[string][]serviceRelayRef, map[string]bool, error) {
	// A draft can point at a new landing while its published path still points
	// elsewhere. Both landings need export access before exposing the relation.
	rows, err := tx.QueryContext(ctx, `SELECT r.id,r.engine_id,e.node_id,r.landing_engine_id,r.landing_service_id,l.node_id,
		json_extract(r.draft_json,'$.name'),p.route_id IS NOT NULL,coalesce(old.node_id,'')
		FROM relay_routes r JOIN engines e ON e.id=r.engine_id JOIN engines l ON l.id=r.landing_engine_id
		LEFT JOIN relay_publications p ON p.route_id=r.id AND p.revision=r.target_revision
		LEFT JOIN engines old ON old.id=json_extract(p.path_json,'$.landing_engine_id')
		JOIN users u ON u.id=? AND u.disabled=0
		WHERE r.deleted=0 AND (u.role='admin' OR EXISTS (SELECT 1 FROM engine_node_grants g WHERE g.node_id=e.node_id AND g.user_id=u.id))
		ORDER BY r.id`, actor)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	byLanding := map[string][]serviceRelayRef{}
	managed := map[string]bool{}
	for rows.Next() {
		var id, entryEngine, entryNode, landingEngine, service, landingNode, name, oldNode string
		var published bool
		if err := rows.Scan(&id, &entryEngine, &entryNode, &landingEngine, &service, &landingNode, &name, &published, &oldNode); err != nil {
			return nil, nil, err
		}
		entry := nodes[entryNode]
		visible := nodes[landingNode].export && (!published || nodes[oldNode].export)
		managed[entryEngine+"/"+id] = visible || entry.CanManage
		if visible {
			key := landingEngine + "/" + service
			byLanding[key] = append(byLanding[key], serviceRelayRef{id, strings.ToLower(name + " " + entry.Name)})
		}
	}
	return byLanding, managed, rows.Err()
}

func servicePresets(ctx context.Context, tx *sql.Tx, actor string) (map[string]proxy.Preset, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id,config_json,created_at FROM protocol_presets WHERE id IN (
		SELECT json_extract(svc.value,'$.preset_id') FROM engine_drafts d JOIN engines e ON e.id=d.engine_id
		JOIN users u ON u.id=? AND u.disabled=0 CROSS JOIN json_each(d.services_json) svc
		WHERE e.ownership='managed' AND (u.role='admin' OR EXISTS (
		SELECT 1 FROM engine_node_grants g WHERE g.node_id=e.node_id AND g.user_id=u.id)))`, actor)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	presets := map[string]proxy.Preset{}
	for rows.Next() {
		p, err := scanPreset(rows)
		if err != nil {
			return nil, err
		}
		presets[p.ID] = p
	}
	return presets, rows.Err()
}

func (s *Store) ProxyServices(ctx context.Context, actor string, q proxy.ServiceListQuery) (proxy.ServiceList, error) {
	out := proxy.ServiceList{Items: []proxy.ServiceListItem{}, Nodes: []proxy.ServiceNode{}}
	if q.Limit < 1 || q.Limit > 50 || !validSubscriptionSearch(q.Search) {
		return out, proxy.ErrInvalid
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	if err = presetAccess(ctx, tx, actor, false); err != nil {
		return out, err
	}
	nodes, err := serviceNodes(ctx, tx, actor, &out)
	if err != nil {
		return out, err
	}
	relays, managed, err := serviceRelayIndex(ctx, tx, actor, nodes)
	if err != nil {
		return out, err
	}
	presets, err := servicePresets(ctx, tx, actor)
	if err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT `+engineColumns+` FROM engines e JOIN engine_drafts d ON d.engine_id=e.id
		JOIN users u ON u.id=? AND u.disabled=0 WHERE e.ownership='managed' AND
		(u.role='admin' OR EXISTS (SELECT 1 FROM engine_node_grants g WHERE g.node_id=e.node_id AND g.user_id=u.id)) ORDER BY e.id`, actor)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	keyword := strings.ToLower(strings.TrimSpace(q.Search))
	afterEngine, afterService, _ := strings.Cut(q.After, "/")
	for rows.Next() {
		e, err := scanEngine(rows)
		if err != nil {
			return out, err
		}
		node := nodes[e.NodeID]
		published := map[string]*proxy.Service{}
		if e.PublishedDraft != nil {
			for i := range e.PublishedDraft.Services {
				v := &e.PublishedDraft.Services[i]
				published[v.ID] = v
			}
		}
		slices.SortFunc(e.Draft.Services, func(a, b proxy.Service) int { return strings.Compare(a.ID, b.ID) })
		for _, svc := range e.Draft.Services {
			key := e.ID + "/" + svc.ID
			if visible, ok := managed[key]; e.Name == "realm" && ok {
				if visible {
					out.ManagedRelayCount++
				}
				continue
			}
			protocol, presetName := "VLESS / TCP / REALITY", ""
			if e.Name == "realm" {
				protocol = "TCP 转发"
			}
			if svc.PresetID != "" {
				p, ok := presets[svc.PresetID]
				if !ok {
					return out, proxy.ErrUnavailable
				}
				presetName = p.Config.Name
				protocol = strings.ToUpper(p.Config.Protocol + " / " + p.Config.Transport + " / " + p.Config.Security)
				if p.Referenceable {
					svc = proxy.ResolvePreset(svc, p.Config)
				}
			}
			item := proxy.DescribeService(node.ServiceNode, e, svc, published[svc.ID], presetName, protocol)
			item.RelayEligible = item.RelayEligible && node.export
			pending := slices.Contains([]string{"draft", "pending", "unpublished", "pending_delete"}, item.Configuration)
			running := item.Runtime == "running"
			attention := item.Runtime == "degraded" || e.SyncState == "failed" || node.State != "online" || e.LastError == "engine_external"
			out.Counts.All++
			if running {
				out.Counts.Running++
			}
			if pending {
				out.Counts.Pending++
			}
			if attention {
				out.Counts.Attention++
			}
			if key == q.Selected {
				out.Selected = &item
			}
			if e.ID < afterEngine || e.ID == afterEngine && svc.ID <= afterService || q.Node != "" && q.Node != node.ID || q.Engine != "" && q.Engine != e.Name {
				continue
			}
			if q.Status == "running" && !running || q.Status == "pending" && !pending || q.Status == "attention" && !attention {
				continue
			}
			refs := relays[key]
			if q.Access == "relayed" && len(refs) == 0 || q.Access == "direct" && (len(refs) > 0 || e.Name == "realm") {
				continue
			}
			if !item.MatchesSearch(keyword) && !slices.ContainsFunc(refs, func(ref serviceRelayRef) bool { return strings.Contains(ref.search, keyword) }) {
				continue
			}
			if len(out.Items) == q.Limit {
				out.NextCursor = out.Items[q.Limit-1].ID
				continue
			}
			out.Items = append(out.Items, item)
		}
	}
	if err = rows.Err(); err != nil {
		return out, err
	}
	rows.Close()
	// Only hydrate diagnostics for the returned page and a deep-linked service.
	hydrate := func(item *proxy.ServiceListItem) error {
		for _, ref := range relays[item.ID] {
			route, _, err := s.relayDetailTx(ctx, tx, actor, ref.id, false)
			if err != nil {
				return err
			}
			if !route.CleanupOnly {
				item.Relays = append(item.Relays, route)
			}
		}
		return nil
	}
	for i := range out.Items {
		if err = hydrate(&out.Items[i]); err != nil {
			return out, err
		}
		if out.Items[i].ID == q.Selected {
			out.Selected = nil
		}
	}
	if out.Selected != nil {
		if err = hydrate(out.Selected); err != nil {
			return out, err
		}
	}
	return out, tx.Commit()
}
