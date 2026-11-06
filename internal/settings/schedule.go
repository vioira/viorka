package settings

import (
	"context"
	"log/slog"
	"time"
)

// RunSchedule belongs to the application's lifecycle. Missed minutes are not replayed.
func (b *Backups) RunSchedule(ctx context.Context, settings *Service) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		work, cancel := context.WithTimeout(ctx, 3*time.Minute)
		err := b.scheduled(work, settings, time.Now().UTC())
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.Error("scheduled backup or retention failed")
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
func (b *Backups) scheduled(ctx context.Context, _ *Service, now time.Time) error {
	p, err := b.Policy(ctx)
	if err != nil {
		return err
	}
	b.mu.Lock()
	err = b.prune(ctx, p)
	b.mu.Unlock()
	if err != nil {
		return err
	}
	if !p.Enabled {
		return nil
	}
	schedule, err := cronParser.Parse(p.Cron)
	if err != nil {
		return err
	}
	minute := now.UTC().Truncate(time.Minute)
	if !schedule.Next(minute.Add(-time.Minute)).Equal(minute) {
		return nil
	}
	list, err := b.List()
	if err != nil {
		return err
	}
	for _, v := range list {
		if v.Trigger == "scheduled" && !v.CreatedAt.Before(minute) {
			return nil
		}
	}
	_, err = b.Create(ctx, "")
	return err
}
