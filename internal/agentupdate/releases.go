// Package agentupdate reads the official stable release and schedules node updates.
package agentupdate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	v1 "github.com/vioira/viorka/protocol/v1"
)

// TaskInfo is the immutable, public target recorded when the task is submitted.
type TaskInfo struct {
	Target v1.AgentUpdate `json:"target"`
	From   string         `json:"from"`
	Source string         `json:"source" enum:"manual,auto"`
}

type AgentUpdateStatus struct {
	Auto       bool            `json:"auto_update"`
	Capable    bool            `json:"capable"`
	Online     bool            `json:"online"`
	Current    string          `json:"current_version"`
	Target     *v1.AgentUpdate `json:"target,omitempty"`
	CheckedAt  string          `json:"checked_at,omitempty"`
	Available  bool            `json:"available"`
	ActiveTask string          `json:"active_task,omitempty"`
}

type repository interface {
	SaveAgentReleases(context.Context, map[string]v1.AgentUpdate) error
	ScheduleAgentUpdate(context.Context, string) (string, error)
}

func Run(ctx context.Context, repo repository) {
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	tick := time.NewTicker(15 * time.Second)
	defer tick.Stop()
	var next time.Time
	var cursor string
	for ctx.Err() == nil {
		if !time.Now().Before(next) {
			assets, err := fetch(ctx, client)
			if err == nil {
				err = repo.SaveAgentReleases(ctx, assets)
			}
			next = time.Now().Add(time.Hour)
			if err != nil && ctx.Err() == nil {
				slog.Warn("Agent release check failed", "error", err)
				next = time.Now().Add(5 * time.Minute)
			}
		}
		work, cancel := context.WithTimeout(ctx, 5*time.Second)
		var err error
		cursor, err = repo.ScheduleAgentUpdate(work, cursor)
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.Error("Agent update scheduling failed", "error", err)
		}
		select {
		case <-tick.C:
		case <-ctx.Done():
			return
		}
	}
}
func fetch(ctx context.Context, c *http.Client) (map[string]v1.AgentUpdate, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/vioira/viorka-agent/releases/latest", nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("release HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, (2<<20)+1))
	if err != nil {
		return nil, err
	}
	if len(b) > 2<<20 {
		return nil, errors.New("release response too large")
	}
	var r struct {
		Tag               string `json:"tag_name"`
		Draft, Prerelease bool
		Assets            []struct{ Name, Digest string }
	}
	if err = json.Unmarshal(b, &r); err != nil {
		return nil, err
	}
	if r.Draft || r.Prerelease {
		return nil, errors.New("unstable release")
	}
	digests := map[string]string{}
	for _, a := range r.Assets {
		digests[a.Name] = a.Digest
	}
	result := map[string]v1.AgentUpdate{}
	for _, arch := range []string{"amd64", "arm64"} {
		name := "viorka-agent-linux-" + arch
		digest, ok := strings.CutPrefix(digests[name], "sha256:")
		target := v1.AgentUpdate{Version: r.Tag, SHA256: digest}
		if _, signed := digests[name+".sig"]; signed && ok && target.Valid() {
			result[arch] = target
		}
	}
	return result, nil
}
