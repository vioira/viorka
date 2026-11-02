package monitoring

import (
	"encoding/json"
	v1 "github.com/vioira/viorka/protocol/v1"
	"testing"
	"time"
)

func TestFilesystemValidationAndLegacy(t *testing.T) {
	now := time.Now()
	m := sample(now)
	m.Filesystems = &v1.FilesystemMetrics{Mounts: []*v1.FilesystemUsage{{MountPoint: "/", FilesystemType: "ext4", Usage: m.Disk}, {MountPoint: "/data", FilesystemType: "xfs", Usage: &v1.DiskMetrics{TotalBytes: 200, UsedBytes: 40, AvailableBytes: 150}}}, Errors: []string{}}
	b, _ := json.Marshal(m)
	if _, err := Decode(b, now); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(map[string]any){
		func(f map[string]any) { delete(f, "errors") },
		func(f map[string]any) { f["mounts"] = nil },
		func(f map[string]any) { f["errors"] = []string{"filesystems_unavailable"} },
		func(f map[string]any) { f["mounts"].([]any)[1].(map[string]any)["mount_point"] = "/" },
		func(f map[string]any) { f["mounts"].([]any)[0] = nil },
		func(f map[string]any) {
			delete(f["mounts"].([]any)[0].(map[string]any)["usage"].(map[string]any), "used_bytes")
		},
		func(f map[string]any) {
			f["mounts"].([]any)[0].(map[string]any)["usage"].(map[string]any)["available_bytes"] = 1000
		},
	} {
		var raw map[string]any
		json.Unmarshal(b, &raw)
		mutate(raw["filesystems"].(map[string]any))
		bad, _ := json.Marshal(raw)
		if _, err := Decode(bad, now); err == nil {
			t.Fatalf("accepted invalid filesystems: %s", bad)
		}
	}
	for _, f := range []*v1.FilesystemMetrics{nil, {Mounts: []*v1.FilesystemUsage{}, Errors: []string{"filesystems_unavailable"}}} {
		m.Filesystems = f
		b, _ = json.Marshal(m)
		if _, err := Decode(b, now); err != nil {
			t.Fatal(err)
		}
	}
	// Existing root-only historical series must not silently include /data.
	m.Filesystems = &v1.FilesystemMetrics{Mounts: []*v1.FilesystemUsage{{MountPoint: "/data", FilesystemType: "ext4", Usage: &v1.DiskMetrics{TotalBytes: 200, UsedBytes: 40, AvailableBytes: 150}}}, Errors: []string{}}
	if metricValues(m)["disk_total_bytes"] != m.Disk.TotalBytes {
		t.Fatal("root history semantics changed")
	}
}
