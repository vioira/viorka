package httpapi

import (
	"encoding/json"

	"github.com/vioira/viorka/internal/monitoring"

	"testing"
)

func TestHistoryDTOKeepsCounterPrecisionAndNull(t *testing.T) {
	large := uint64(9007199254740993)
	h := historyResponse(monitoring.History{PeriodSeconds: 30, Points: []monitoring.Bucket{{NetInTotal: &large, Filesystems: []monitoring.FilesystemBucket{{Total: large}}}}})
	b, err := json.Marshal(h)
	if err != nil {
		t.Fatal(err)
	}
	var raw map[string]any
	if err = json.Unmarshal(b, &raw); err != nil {
		t.Fatal(err)
	}
	point := raw["points"].([]any)[0].(map[string]any)
	if point["net_in_total"] != "9007199254740993" || point["net_out_total"] != nil || point["cpu"].(map[string]any)["sum"] != nil {
		t.Fatal(string(b))
	}
	if point["filesystems"].([]any)[0].(map[string]any)["total_bytes"] != "9007199254740993" {
		t.Fatal("filesystem lost precision", string(b))
	}
}
