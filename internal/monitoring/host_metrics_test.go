package monitoring

import (
	"encoding/json"
	v1 "github.com/vioira/viorka/protocol/v1"
	"testing"
	"time"
)

func TestHostMetricsValidation(t *testing.T) {
	now := time.Now()
	m := sample(now)
	n := uint64(10)
	m.Host = &v1.HostMetrics{DiskIo: []*v1.DiskIOMetrics{{Device: "8:0:sda", ReadBytes: 512, WriteBytes: 1024}}, TcpSockets: &n, UdpSockets: &n, Processes: &n, Errors: []string{}}
	b, _ := json.Marshal(m)
	if _, e := Decode(b, now); e != nil {
		t.Fatal(e)
	}
	for _, mutate := range []func(map[string]any){
		func(h map[string]any) { delete(h, "errors") },
		func(h map[string]any) { delete(h, "processes") },
		func(h map[string]any) { h["tcp_sockets"] = -1 },
		func(h map[string]any) { h["udp_sockets"] = 1048577 },
		func(h map[string]any) { h["errors"] = []string{"sockets_unavailable"} },
		func(h map[string]any) { delete(h["disk_io"].([]any)[0].(map[string]any), "read_bytes") },
		func(h map[string]any) { h["disk_io"].([]any)[0].(map[string]any)["write_bytes_per_second"] = -1 },
	} {
		var raw map[string]any
		json.Unmarshal(b, &raw)
		mutate(raw["host"].(map[string]any))
		bad, _ := json.Marshal(raw)
		if _, e := Decode(bad, now); e == nil {
			t.Fatalf("accepted %s", bad)
		}
	}
	m.Host = &v1.HostMetrics{DiskIo: []*v1.DiskIOMetrics{}, Errors: []string{"disk_io_unavailable", "sockets_unavailable", "processes_unavailable"}}
	b, _ = json.Marshal(m)
	if _, e := Decode(b, now); e != nil {
		t.Fatal(e)
	}
	m.Host = nil
	b, _ = json.Marshal(m)
	if _, e := Decode(b, now); e != nil {
		t.Fatal("legacy rejected", e)
	}
}
