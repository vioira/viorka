package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
)

type Config struct{ ListenAddr, DatabasePath, Origin, AdminUsername, AdminPasswordFile, TLSCert, TLSKey string }

func FromEnv() (Config, error) {
	values, err := readEnvFile()
	if err != nil {
		return Config{}, err
	}
	get := func(key string) string {
		if v, ok := os.LookupEnv(key); ok {
			return v
		}
		return values[key]
	}
	c := Config{ListenAddr: get("VIORKA_LISTEN"), DatabasePath: get("VIORKA_DATABASE"), Origin: get("VIORKA_ORIGIN"), AdminUsername: get("VIORKA_ADMIN_USERNAME"), AdminPasswordFile: get("VIORKA_ADMIN_PASSWORD_FILE"), TLSCert: get("VIORKA_TLS_CERT"), TLSKey: get("VIORKA_TLS_KEY")}
	if c.ListenAddr == "" {
		c.ListenAddr = "127.0.0.1:8080"
	}
	host, _, err := net.SplitHostPort(c.ListenAddr)
	if err != nil {
		return c, fmt.Errorf("VIORKA_LISTEN: %w", err)
	}
	if c.DatabasePath == "" {
		c.DatabasePath = "data/viorka.db"
	}
	if c.Origin == "" {
		c.Origin = "http://127.0.0.1:5173"
	}
	u, err := url.Parse(c.Origin)
	if err != nil || u.Host == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") {
		return c, fmt.Errorf("VIORKA_ORIGIN must be an exact HTTP(S) origin")
	}
	loopback := net.ParseIP(host) != nil && net.ParseIP(host).IsLoopback()
	if !loopback && (c.TLSCert == "" || u.Scheme != "https") {
		return c, fmt.Errorf("public listener requires TLS and HTTPS VIORKA_ORIGIN")
	}
	if u.Scheme == "http" && u.Hostname() != "localhost" && (net.ParseIP(u.Hostname()) == nil || !net.ParseIP(u.Hostname()).IsLoopback()) {
		return c, fmt.Errorf("HTTP origin must be loopback")
	}
	if (c.TLSCert == "") != (c.TLSKey == "") {
		return c, fmt.Errorf("TLS certificate and key must be configured together")
	}
	if c.AdminUsername == "" {
		c.AdminUsername = "admin"
	}
	if len(c.AdminUsername) > 64 || strings.TrimSpace(c.AdminUsername) == "" {
		return c, fmt.Errorf("invalid bootstrap username")
	}
	return c, nil
}
