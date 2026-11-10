package httpapi

import (
	"context"
	"encoding/json"
	"github.com/vioira/viorka/internal/inventory"
	"github.com/vioira/viorka/internal/realtime"
	"io"
	"net/http"
	"sort"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/settings"
)

// NotificationDelta contains only changed records and IDs no longer retained.
type NotificationDelta struct {
	Items      []settings.Notification `json:"items"`
	RemovedIDs []string                `json:"removed_ids"`
}

// A nil previous map starts a new connection with an authoritative snapshot.
// Retaining only the current window bounds per-connection memory to 100 records.
func notificationFrame(previous map[string]settings.Notification, items []settings.Notification) (string, map[string]settings.Notification, error) {
	next := make(map[string]settings.Notification, len(items))
	delta := NotificationDelta{Items: []settings.Notification{}, RemovedIDs: []string{}}
	for _, item := range items {
		next[item.ID] = item
		if old, ok := previous[item.ID]; !ok || old != item {
			delta.Items = append(delta.Items, item)
		}
	}
	for id := range previous {
		if _, ok := next[id]; !ok {
			delta.RemovedIDs = append(delta.RemovedIDs, id)
		}
	}
	sort.Strings(delta.RemovedIDs)
	event := "notifications"
	var value any = delta
	if previous == nil {
		event = "snapshot"
		if items == nil {
			items = []settings.Notification{}
		}
		value = NotificationsResponse{Items: items}
	} else if len(delta.Items) == 0 && len(delta.RemovedIDs) == 0 {
		return ": heartbeat\n\n", next, nil
	}
	payload, err := json.Marshal(value)
	return "event: " + event + "\ndata: " + string(payload) + "\n\n", next, err
}

// streamAccess validates the live session before data leaves the server. Heartbeat
// checks bound revocation latency even while no business events are arriving.
func (a *api) streamAccess(r *http.Request) bool {
	cookie, err := r.Cookie("viorka_session")
	if err != nil {
		return false
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if _, err := a.Auth.Session(ctx, cookie.Value); err != nil {
		return false
	}
	if a.Settings != nil {
		v, err := a.Settings.Get(ctx)
		if err != nil || !v.SSE {
			return false
		}
	}
	return true
}
func (a *api) startStream(w http.ResponseWriter, r *http.Request) (func(), bool) {
	if a.Settings != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		v, err := a.Settings.Get(ctx)
		cancel()
		if err != nil {
			problem(w, err)
			return nil, false
		}
		if !v.SSE {
			fail(w, 409, "events_disabled", "实时推送已关闭")
			return nil, false
		}
	}
	select {
	case a.streams <- struct{}{}:
	default:
		fail(w, 429, "stream_limit", "连接过多，请关闭多余页面")
		return nil, false
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Cache-Control", "no-cache")
	return func() { <-a.streams }, true
}
func streamFrame(w http.ResponseWriter, frame string) bool {
	rc := http.NewResponseController(w)
	if rc.SetWriteDeadline(time.Now().Add(5*time.Second)) != nil {
		return false
	}
	if _, err := io.WriteString(w, frame); err != nil {
		return false
	}
	return rc.Flush() == nil
}
func streamJSON(w http.ResponseWriter, event string, value any) bool {
	b, err := json.Marshal(value)
	return err == nil && streamFrame(w, "event: "+event+"\ndata: "+string(b)+"\n\n")
}

type ResourceChange struct {
	realtime.Change
	Node *inventory.Node `json:"node,omitempty"`
}

func (a *api) events(w http.ResponseWriter, r *http.Request, session auth.Session) {
	if r.URL.RawQuery != "" {
		problem(w, auth.ErrInvalid)
		return
	}
	done, ok := a.startStream(w, r)
	if !ok {
		return
	}
	defer done()
	sub := a.Events.Subscribe(func(c realtime.Change) bool {
		return c.Kind != "metrics" && (c.UserID == "" || c.UserID == session.User.ID)
	})
	defer sub.Close()
	var previous map[string]settings.Notification
	notifications := func(reset bool) bool {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		items := []settings.Notification{}
		if a.Settings != nil {
			var err error
			items, err = a.Settings.Notifications(ctx, session.User.ID)
			if err != nil {
				return false
			}
		}
		if reset {
			previous = nil
		}
		frame, next, err := notificationFrame(previous, items)
		if err != nil || !streamFrame(w, frame) {
			return false
		}
		previous = next
		return true
	}
	if !a.streamAccess(r) {
		return
	}
	if !notifications(true) || !streamJSON(w, "ready", struct{}{}) {
		return
	}
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-a.Shutdown.Done():
			return
		case <-heartbeat.C:
			if !a.streamAccess(r) {
				streamJSON(w, "closed", struct{}{})
				return
			}
			if !streamFrame(w, ": heartbeat\n\n") {
				return
			}
		case <-sub.Wake:
			if !a.streamAccess(r) {
				streamJSON(w, "closed", struct{}{})
				return
			}
			changes, reset := sub.Drain()
			if reset {
				if !notifications(true) || !streamJSON(w, "ready", struct{}{}) {
					return
				}
				continue
			}
			for _, c := range changes {
				if c.Kind == "access" {
					continue
				}
				if c.Kind == "notifications" {
					if !notifications(false) {
						return
					}
					continue
				}
				update := ResourceChange{Change: c}
				if c.Kind == "node" {
					ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
					node, err := a.Nodes.Node(ctx, c.NodeID)
					if err == nil {
						items := []inventory.Node{node}
						if err := a.nodeEngines(ctx, session.User.ID, items); err != nil {
							cancel()
							return
						}
						update.Node = &items[0]
					} else if err == auth.ErrNotFound {
						update.Kind = "nodes"
					} else {
						cancel()
						return
					}
					cancel()
				}
				if !streamJSON(w, "change", update) {
					return
				}
			}
		}
	}
}

func (a *api) nodeEngines(ctx context.Context, actor string, nodes []inventory.Node) error {
	ids := make([]string, len(nodes))
	for i := range nodes {
		ids[i] = nodes[i].ID
	}
	summaries, err := a.Nodes.EngineSummaries(ctx, actor, ids)
	if err != nil {
		return err
	}
	for i := range nodes {
		if engines, ok := summaries[nodes[i].ID]; ok {
			nodes[i].Engines = &engines
		}
	}
	return nil
}
