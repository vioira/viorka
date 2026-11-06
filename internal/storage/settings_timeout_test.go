package storage

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/settings"
)

func TestHeartbeatTimeoutSettings(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.InitSettings(ctx, "https://example.com"); err != nil {
		t.Fatal(err)
	}
	service := settings.New(s)
	cfg, err := service.Get(ctx)
	if err != nil || cfg.HeartbeatTimeoutSeconds != 300 {
		t.Fatalf("default: %+v %v", cfg, err)
	}
	for _, seconds := range []int{0, 59, 3601} {
		invalid := cfg
		invalid.HeartbeatTimeoutSeconds = seconds
		if _, err := service.Save(ctx, "admin", invalid); !errors.Is(err, auth.ErrInvalid) {
			t.Fatalf("accepted %d: %v", seconds, err)
		}
		if _, err := s.db.ExecContext(ctx, `UPDATE system_settings SET heartbeat_timeout_seconds=?`, seconds); err == nil {
			t.Fatalf("database accepted %d", seconds)
		}
	}
	for _, seconds := range []int{60, 3600, 300} {
		cfg.HeartbeatTimeoutSeconds = seconds
		saved, err := service.Save(ctx, "admin", cfg)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.Save(ctx, "admin", cfg); !errors.Is(err, auth.ErrConflict) {
			t.Fatalf("stale revision: %v", err)
		}
		cfg = saved
		got, err := s.HeartbeatTimeout(ctx)
		if err != nil || got != time.Duration(seconds)*time.Second {
			t.Fatalf("live policy: %s %v", got, err)
		}
	}
}
