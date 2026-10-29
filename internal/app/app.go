package app

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/vioira/viorka/internal/httpapi"
	"github.com/vioira/viorka/internal/platform/config"
)

// Run starts the M0 scaffold HTTP API. No database or agent gateway is connected yet.
func Run(cfg config.Config) error {
	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           httpapi.NewRouter(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	result := make(chan error, 1)
	go func() { result <- srv.ListenAndServe() }()
	slog.Info("viorka scaffold API started", "listen", cfg.ListenAddr)

	select {
	case err := <-result:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		return srv.Shutdown(shutdown)
	}
}
