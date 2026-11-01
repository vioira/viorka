package httpapi

import (
	"bufio"
	"encoding/json"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/settings"
)

func TestNotificationFrames(t *testing.T) {
	old := settings.Notification{ID: "old", Message: "offline"}
	newItem := settings.Notification{ID: "new", Message: "offline"}
	frame, state, err := notificationFrame(nil, []settings.Notification{old})
	if err != nil || !strings.HasPrefix(frame, "event: snapshot\n") || !strings.Contains(frame, "old") {
		t.Fatalf("initial snapshot: %q %v", frame, err)
	}
	frame, state, err = notificationFrame(state, []settings.Notification{old})
	if err != nil || frame != ": heartbeat\n\n" {
		t.Fatalf("unchanged history repeated: %q %v", frame, err)
	}
	frame, state, err = notificationFrame(state, []settings.Notification{newItem, old})
	if err != nil || !strings.HasPrefix(frame, "event: notifications\n") {
		t.Fatalf("delta: %q %v", frame, err)
	}
	var delta NotificationDelta
	payload := strings.TrimSuffix(strings.TrimPrefix(frame, "event: notifications\ndata: "), "\n\n")
	if err := json.Unmarshal([]byte(payload), &delta); err != nil {
		t.Fatal(err)
	}
	if len(delta.Items) != 1 || delta.Items[0].ID != "new" || len(delta.RemovedIDs) != 0 {
		t.Fatalf("delta repeated history: %+v", delta)
	}
	frame, state, err = notificationFrame(state, []settings.Notification{newItem})
	if err != nil || !strings.Contains(frame, `"removed_ids":["old"]`) || !strings.Contains(frame, `"items":[]`) || len(state) != 1 {
		t.Fatalf("retention: %q %v", frame, err)
	}
	newItem.Read = true
	frame, state, err = notificationFrame(state, []settings.Notification{newItem})
	if err != nil || !strings.Contains(frame, `"read":true`) {
		t.Fatalf("read delta: %q %v", frame, err)
	}
	newItem.Message = "updated"
	frame, _, err = notificationFrame(state, []settings.Notification{newItem})
	if err != nil || !strings.Contains(frame, "updated") {
		t.Fatalf("update: %q %v", frame, err)
	}
	frame, _, err = notificationFrame(nil, nil)
	if err != nil || frame != "event: snapshot\ndata: {\"items\":[]}\n\n" {
		t.Fatalf("empty reconnect snapshot: %q %v", frame, err)
	}
}

func TestSSEUnchangedNotificationsSendHeartbeat(t *testing.T) {
	f := setup(t, "admin")
	enableSettings(t, f)
	res := f.request("GET", "/api/v1/events", nil, true)
	defer res.Body.Close()
	if res.StatusCode != 200 || res.Header.Get("Cache-Control") != "no-cache" {
		t.Fatalf("stream response: %d %v", res.StatusCode, res.Header)
	}
	reader := bufio.NewReader(res.Body)
	readFrame := func() string {
		t.Helper()
		var frame strings.Builder
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				t.Fatal(err)
			}
			frame.WriteString(line)
			if line == "\n" {
				return frame.String()
			}
		}
	}
	if got := readFrame(); got != "event: snapshot\ndata: {\"items\":[]}\n\n" {
		t.Fatalf("initial: %q", got)
	}
	if got := readFrame(); got != "event: ready\ndata: {}\n\n" {
		t.Fatalf("ready: %q", got)
	}
}
