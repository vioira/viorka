package app

import (
	"context"
	"crypto/tls"
	"errors"
	"github.com/vioira/viorka/internal/auth"
	"github.com/vioira/viorka/internal/gateway"
	"github.com/vioira/viorka/internal/httpapi"
	"github.com/vioira/viorka/internal/monitoring"
	"github.com/vioira/viorka/internal/platform/config"
	"github.com/vioira/viorka/internal/scheduler"
	"github.com/vioira/viorka/internal/settings"
	"github.com/vioira/viorka/internal/storage"
	"log/slog"
	"net/http"
	"os/signal"
	"syscall"
	"time"
)

func Run(cfg config.Config) error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	startup, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	pending, err := settings.NewBackups(cfg.DatabasePath, nil, storage.ValidateSnapshot)
	if err != nil {
		return err
	}
	if err = pending.ApplyPending(startup, cfg.DatabasePath, storage.PrepareRestoredSnapshot, storage.CheckpointBeforeRestore); err != nil {
		return err
	}
	store, err := storage.Open(startup, cfg.DatabasePath)
	if err != nil {
		return err
	}
	defer store.Close()
	if err = store.InitSettings(startup, cfg.Origin); err != nil {
		return err
	}
	saved, err := store.Settings(startup)
	if err != nil {
		return err
	}
	cfg.Origin = saved.PublicOrigin
	backups, err := settings.NewBackups(cfg.DatabasePath, store, storage.ValidateSnapshot)
	if err != nil {
		return err
	}
	users, err := auth.New(store)
	if err != nil {
		return err
	}
	if err = bootstrapAdmin(startup, cfg, store, users); err != nil {
		return err
	}

	if err = store.Recover(startup); err != nil {
		return err
	}
	background, finish := context.WithCancel(ctx)
	backgroundDone := make(chan struct{})
	go func() {
		defer close(backgroundDone)
		tick := time.NewTicker(time.Second)
		defer tick.Stop()
		for {
			select {
			case <-background.Done():
				return
			case <-tick.C:
				work, cancel := context.WithTimeout(background, 5*time.Second)
				err := store.Expire(work)
				cancel()

				if err != nil && background.Err() == nil {
					slog.Error("task expiry failed")
				}
			}
		}
	}()
	backupDone := make(chan struct{})
	go func() { defer close(backupDone); backups.RunSchedule(background, settings.New(store)) }()
	defer func() { finish(); <-backgroundDone; <-backupDone }()
	agents := auth.NewAgents(store, cfg.Origin)
	gate := gateway.New(store, agents)
	recorder, err := monitoring.NewRecorder(startup, store)
	if err != nil {
		return err
	}
	gate.SetRecorder(recorder)
	metricsCtx, stopMetrics := context.WithCancel(context.Background())
	metricsDone := make(chan struct{})
	go func() { defer close(metricsDone); recorder.Run(metricsCtx) }()
	defer func() {
		gate.Close()
		stopMetrics()
		<-metricsDone
		flush, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := recorder.Flush(flush, time.Now(), true); err != nil {
			slog.Error("final metric history flush failed")
		}
	}()
	srv := &http.Server{Addr: cfg.ListenAddr, Handler: httpapi.NewRouter(httpapi.Dependencies{Audit: store, History: store, Settings: settings.New(store), Backups: backups, Auth: users, Agents: agents, Nodes: store, Tasks: scheduler.New(store), Gateway: gate, Ready: store.Ping, Origin: cfg.Origin, Shutdown: ctx}), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16384, TLSConfig: &tls.Config{MinVersion: tls.VersionTLS12}}
	result := make(chan error, 1)
	go func() {
		if cfg.TLSCert != "" {
			result <- srv.ListenAndServeTLS(cfg.TLSCert, cfg.TLSKey)
		} else {
			result <- srv.ListenAndServe()
		}
	}()
	slog.Info("viorka API starting", "listen", cfg.ListenAddr)
	select {
	case err = <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		gate.Close()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		err = srv.Shutdown(shutdown)
		if err != nil {
			srv.Close()
		}
		return err
	}
}
