package monitoring

import (
	"encoding/json"
	"fmt"
	v1 "github.com/vioira/viorka/protocol/v1"
	"path"
	"strings"
	"unicode/utf8"
)

func validateFilesystems(f *v1.FilesystemMetrics, data json.RawMessage) error {
	if f == nil {
		return nil
	}
	if f.Mounts == nil || f.Errors == nil || len(f.Mounts) > 32 || len(f.Errors) > 1 {
		return fmt.Errorf("invalid filesystem metrics")
	}
	if len(f.Errors) > 0 {
		if f.Errors[0] != "filesystems_unavailable" || len(f.Mounts) != 0 {
			return fmt.Errorf("inconsistent filesystem availability")
		}
		return nil
	}
	var raw struct {
		Mounts []struct {
			Usage map[string]json.RawMessage `json:"usage"`
		} `json:"mounts"`
	}
	if json.Unmarshal(data, &raw) != nil || len(raw.Mounts) != len(f.Mounts) {
		return fmt.Errorf("invalid filesystem list")
	}
	seen := map[string]bool{}
	for i, m := range f.Mounts {
		if m == nil || len(m.MountPoint) == 0 || len(m.MountPoint) > 512 || !strings.HasPrefix(m.MountPoint, "/") || path.Clean(m.MountPoint) != m.MountPoint || !utf8.ValidString(m.MountPoint) || strings.ContainsAny(m.MountPoint, "\x00\r\n\t") || seen[m.MountPoint] || len(m.FilesystemType) == 0 || len(m.FilesystemType) > 32 {
			return fmt.Errorf("invalid filesystem identity")
		}
		seen[m.MountPoint] = true
		for _, k := range []string{"total_bytes", "used_bytes", "available_bytes"} {
			v, ok := raw.Mounts[i].Usage[k]
			if !ok || string(v) == "null" {
				return fmt.Errorf("missing filesystem counter")
			}
		}
		v := m.Usage
		if v == nil || v.TotalBytes == 0 || !bounded(v.TotalBytes, 1e24) || !bounded(v.UsedBytes, v.TotalBytes) || !bounded(v.AvailableBytes, v.TotalBytes) || v.UsedBytes+v.AvailableBytes > v.TotalBytes {
			return fmt.Errorf("invalid filesystem counters")
		}
	}
	return nil
}
