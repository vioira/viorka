package main

import (
	"log/slog"
	"os"

	"github.com/vioira/viorka/internal/app"
	"github.com/vioira/viorka/internal/platform/config"
)

func main() {
	cfg, err := config.FromEnv()
	if err != nil {
		slog.Error("invalid config", "error", err)
		os.Exit(2)
	}
	if err := app.Run(cfg); err != nil {
		slog.Error("server stopped", "error", err)
		os.Exit(1)
	}
}
