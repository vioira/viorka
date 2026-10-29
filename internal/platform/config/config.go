// Package config loads the minimal boot configuration for the scaffold server.
package config

import (
	"fmt"
	"net"
	"os"
)

type Config struct {
	ListenAddr string
}

func FromEnv() (Config, error) {
	addr := os.Getenv("VIORKA_LISTEN")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}
	if _, _, err := net.SplitHostPort(addr); err != nil {
		return Config{}, fmt.Errorf("VIORKA_LISTEN: %w", err)
	}
	return Config{ListenAddr: addr}, nil
}
