package settings

import (
	"context"
	"log/slog"
	"time"
)

// RunSchedule belongs to the application's lifecycle; it never holds up task expiry.
func (b *Backups) RunSchedule(ctx context.Context, settings *Service) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		work, cancel := context.WithTimeout(ctx, 30*time.Second)
		err := b.scheduled(work, settings, time.Now().UTC())
		cancel()
		if err != nil && ctx.Err() == nil {
			slog.Error("scheduled backup failed")
		}
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
	}
}
func (b *Backups) scheduled(ctx context.Context, settings *Service, now time.Time) error {
	config, e := settings.Get(ctx)
	if e != nil {
		return e
	}
	if !config.AutoBackup || now.Hour() < 3 {
		return nil
	}
	list, e := b.List()
	if e != nil {
		return e
	}
	if len(list) > 0 && list[0].CreatedAt.UTC().Format("2006-01-02") == now.Format("2006-01-02") {
		return nil
	}
	if e = b.Prune(); e != nil {
		return e
	}
	_, e = b.Create(ctx, "")
	return e
}
