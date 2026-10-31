package monitoring

import (
	"encoding/json"
	"fmt"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func validateHost(h *v1.HostMetrics, data json.RawMessage) error {
	if h == nil {
		return nil
	} // Legacy agents do not send this extension.
	var raw map[string]json.RawMessage
	if json.Unmarshal(data, &raw) != nil || h.DiskIo == nil || h.Errors == nil || len(h.DiskIo) > 64 || len(h.Errors) > 3 {
		return fmt.Errorf("invalid host metrics")
	}
	seen := map[string]bool{}
	for _, e := range h.Errors {
		if (e != "disk_io_unavailable" && e != "sockets_unavailable" && e != "processes_unavailable") || seen[e] {
			return fmt.Errorf("invalid host metric error")
		}
		seen[e] = true
	}
	if seen["disk_io_unavailable"] && len(h.DiskIo) > 0 {
		return fmt.Errorf("inconsistent disk IO")
	}
	if (h.TcpSockets == nil || h.UdpSockets == nil) != seen["sockets_unavailable"] || (h.TcpSockets == nil) != (h.UdpSockets == nil) || (h.Processes == nil) != seen["processes_unavailable"] {
		return fmt.Errorf("inconsistent host availability")
	}
	for _, n := range []*uint64{h.TcpSockets, h.UdpSockets, h.Processes} {
		if n != nil && *n > 1048576 {
			return fmt.Errorf("host counter out of range")
		}
	}
	var disks []map[string]json.RawMessage
	if json.Unmarshal(raw["disk_io"], &disks) != nil {
		return fmt.Errorf("invalid disk IO list")
	}
	names := map[string]bool{}
	for i, d := range h.DiskIo {
		if d == nil || len(d.Device) == 0 || len(d.Device) > 64 || names[d.Device] || !bounded(d.ReadBytes, 1e22) || !bounded(d.WriteBytes, 1e22) || !optional(d.ReadBytesPerSecond, 1e22) || !optional(d.WriteBytesPerSecond, 1e22) {
			return fmt.Errorf("invalid disk IO counters")
		}
		for _, key := range []string{"device", "read_bytes", "write_bytes"} {
			if v, ok := disks[i][key]; !ok || string(v) == "null" {
				return fmt.Errorf("missing disk IO counter")
			}
		}
		names[d.Device] = true
	}
	return nil
}
