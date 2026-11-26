package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"slices"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/inventory"
)

type statusStreamNode struct {
	source statusNodeSource
	index  int
}
type statusFeed struct {
	page               StatusPage
	revision, category int64
	nodes              map[string]*statusStreamNode
}

func (a *api) loadStatusFeed(ctx context.Context, repo statusRepository) (*statusFeed, error) {
	_, cat, enabled, err := repo.StatusVersion(ctx)
	if err != nil {
		return nil, err
	}
	if !enabled {
		return nil, auth.ErrNotFound
	}
	pub, err := repo.StatusPublication(ctx)
	if err != nil {
		return nil, err
	}
	if !pub.Enabled {
		return nil, auth.ErrNotFound
	}
	f, err := a.buildStatusFeed(ctx, repo, pub)
	if err != nil {
		return nil, err
	}
	f.category = cat
	rev, latest, on, err := repo.StatusVersion(ctx)
	if err != nil {
		return nil, err
	}
	if !on {
		return nil, auth.ErrNotFound
	}
	if rev != f.revision || latest != cat {
		return nil, auth.ErrConflict
	}
	return f, nil
}

func (a *api) buildStatusFeed(ctx context.Context, repo statusRepository, pub inventory.StatusPublication) (*statusFeed, error) {
	f := &statusFeed{revision: pub.Revision, nodes: map[string]*statusStreamNode{}, page: StatusPage{At: time.Now().UTC(), Nodes: []StatusNode{}}}
	if a.Settings != nil {
		settings, err := a.Settings.Get(ctx)
		if err != nil {
			return nil, err
		}
		f.page.Live = settings.SSE
	}
	for i, entry := range pub.Nodes {
		source, err := a.statusNodeSource(ctx, repo, entry, f.page.At)
		if err != nil {
			return nil, err
		}
		node, err := a.projectStatusNode(source)
		if err != nil {
			return nil, err
		}
		f.nodes[node.ID] = &statusStreamNode{source: source, index: i}
		f.page.Nodes = append(f.page.Nodes, node)
	}
	if err := a.statusRates(ctx, repo, &f.page); err != nil {
		return nil, err
	}
	return f, nil
}

func (a *api) statusRates(ctx context.Context, repo statusRepository, page *StatusPage) error {
	for _, node := range page.Nodes {
		if node.Price != nil && node.Currency != "CNY" {
			rates, err := a.status.fx.Rates(ctx, repo, page.At)
			if err != nil {
				return err
			}
			page.Rates = rates
			return nil
		}
	}
	page.Rates = inventory.ExchangeRates{}
	return nil
}

func (f *statusFeed) snapshot() statusFrame {
	return statusFrame{event: "snapshot", value: f.page, revision: f.revision, category: f.category, final: !f.page.Live}
}

type statusDirty struct{ metadata, lifetime bool }

type statusDelta struct {
	At    time.Time                             `json:"at"`
	Nodes map[string]map[string]json.RawMessage `json:"nodes,omitempty"`
	Rates *inventory.ExchangeRates              `json:"rates,omitempty"`
}

func (a *api) readChangedStatusNode(ctx context.Context, repo statusRepository, state *statusStreamNode, change statusDirty, now time.Time) (StatusNode, error) {
	entry := state.source.base.PublishedNode
	var err error
	if change.metadata {
		state.source, err = a.statusNodeSource(ctx, repo, entry, now)
	} else if change.lifetime {
		state.source.base.Lifetime, err = repo.StatusLifetime(ctx, entry.ID, now)
	}
	if err != nil {
		return StatusNode{}, err
	}
	return a.projectStatusNode(state.source)
}

const statusWindowDuration = 2 * time.Second

func statusWindowEnd(at time.Time) time.Time {
	return at.UTC().Truncate(statusWindowDuration).Add(statusWindowDuration)
}

// The pending values are public projections captured before the boundary. Reading
// the mutable gateway cache during a flush could admit a later window's sample.
type statusWindow struct {
	end          time.Time
	nodes        map[string]StatusNode
	refreshRates bool
}

func (a *api) flushStatusWindow(ctx context.Context, repo statusRepository, f *statusFeed, b *statusBroadcast, window *statusWindow) error {
	delta := statusDelta{At: window.end, Nodes: map[string]map[string]json.RawMessage{}}
	nodes := slices.Clone(f.page.Nodes)
	for id, node := range window.nodes {
		state := f.nodes[id]
		old := nodes[state.index]
		if reflect.DeepEqual(old, node) {
			continue
		}
		window.refreshRates = window.refreshRates || (old.Price == nil) != (node.Price == nil) || old.Currency != node.Currency
		patch, err := statusNodePatch(old, node)
		if err != nil {
			return err
		}
		delta.Nodes[id] = patch
		nodes[state.index] = node
	}
	page := f.page
	page.At, page.Nodes = window.end, nodes
	if window.refreshRates {
		if err := a.statusRates(ctx, repo, &page); err != nil {
			return err
		}
		if !reflect.DeepEqual(f.page.Rates, page.Rates) {
			delta.Rates = &page.Rates
		}
	}
	if len(window.nodes) > 0 || delta.Rates != nil {
		f.page = page
		frame := f.snapshot()
		update := frame
		update.touched = make(map[string]bool, len(window.nodes))
		for id := range window.nodes {
			update.touched[id] = true
		}
		update.event, update.value = "delta", delta
		a.publishStatus(b, frame, update)
	}
	clear(window.nodes)
	window.end = time.Time{}
	window.refreshRates = false
	return nil
}

// Compare only the public wire projection. Missing optional fields explicitly clear
// a previously displayed value. Nested metric groups are atomic observations.
func statusNodePatch(old, node StatusNode) (map[string]json.RawMessage, error) {
	fields := func(n StatusNode) (map[string]json.RawMessage, error) {
		raw, err := json.Marshal(n)
		if err != nil {
			return nil, err
		}
		var out map[string]json.RawMessage
		err = json.Unmarshal(raw, &out)
		return out, err
	}
	before, err := fields(old)
	if err != nil {
		return nil, err
	}
	after, err := fields(node)
	if err != nil {
		return nil, err
	}
	for k, prev := range before {
		switch next, ok := after[k]; {
		case !ok:
			after[k] = json.RawMessage("null")
		case bytes.Equal(prev, next):
			delete(after, k)
		}
	}
	if _, ok := after["speeds"]; ok && len(old.Speeds) > 0 && len(node.Speeds) > 0 {
		// Retain the overlapping suffix and send only newly observed points.
		for i := range old.Speeds {
			keep := len(old.Speeds) - i
			if keep > len(node.Speeds) || !reflect.DeepEqual(old.Speeds[i:], node.Speeds[:keep]) {
				continue
			}
			extra, err := json.Marshal(node.Speeds[keep:])
			if err != nil {
				return nil, err
			}
			after["speeds_append"] = extra
			drop, err := json.Marshal(i)
			if err != nil {
				return nil, err
			}
			after["speeds_drop"] = drop
			delete(after, "speeds")
			break
		}
	}
	return after, nil
}
