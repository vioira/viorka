package config

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strings"
)

// readEnvFile supports literal KEY=value assignments, optional matching quotes,
// blank lines and full-line comments. It never executes or expands shell input.
func readEnvFile() (map[string]string, error) {
	path := os.Getenv("VIORKA_ENV_FILE")
	explicit := path != ""
	if !explicit {
		path = ".env"
	}
	f, err := os.Open(path)
	if !explicit && errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("open environment file: %w", err)
	}
	defer f.Close()
	values := make(map[string]string)
	scanner := bufio.NewScanner(f)
	for line := 1; scanner.Scan(); line++ {
		s := strings.TrimSpace(scanner.Text())
		if s == "" || strings.HasPrefix(s, "#") {
			continue
		}
		key, value, ok := strings.Cut(s, "=")
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		valid := ok && key != ""
		for i, c := range key {
			if !(c == '_' || c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || i > 0 && c >= '0' && c <= '9') {
				valid = false
			}
		}
		if len(value) > 0 && (value[0] == '\'' || value[0] == '"') {
			if len(value) < 2 || value[len(value)-1] != value[0] {
				valid = false
			} else {
				value = value[1 : len(value)-1]
			}
		}
		if !valid {
			return nil, fmt.Errorf("invalid environment assignment at line %d", line)
		}
		values[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read environment file: %w", err)
	}
	return values, nil
}
