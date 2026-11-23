package monitoring

import (
	"context"
	"time"

	v1 "github.com/vioira/viorka/protocol/v1"
)

type UptimeRepository interface {
	SaveNodeUptime(context.Context, string, float64, time.Time, bool) (bool, error)
}

func (s *TelemetryIngress) ConfigureUptime(repo UptimeRepository) { s.uptime = repo }
func (s *TelemetryIngress) UptimeEnabled() bool                   { return s.uptime != nil }

// Called only after admission. The sequence floor excludes replayed samples;
// storage independently fences sample times across runs and Panel restarts.
func (b *telemetryBinding) persistUptime(ctx context.Context, repo UptimeRepository, batch v1.TelemetryBatch, floor [3]uint64) error {
	var latest time.Time
	var seconds float64
	if b.slowUptime {
		for _, ip := range batch.PublicIp {
			u := ip.Uptime
			if ip.Sequence > floor[2] && u != nil && u.Seconds != nil && u.SampledAt.After(latest) {
				latest = u.SampledAt
				seconds = *u.Seconds
			}
		}
	} else {
		for _, f := range batch.Fast {
			if f.Sequence > floor[0] && f.UptimeSeconds != nil && f.SampledAt.After(latest) {
				latest = f.SampledAt
				seconds = *f.UptimeSeconds
			}
		}
		if latest.Before(b.lastLegacyUptime.Add(10 * time.Minute)) {
			return nil
		}
	}
	if latest.IsZero() {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	written, err := repo.SaveNodeUptime(ctx, batch.NodeID, seconds, latest, !b.slowUptime)
	if err != nil {
		return err
	}
	if written && !b.slowUptime {
		b.lastLegacyUptime = latest
	}
	return nil
}
