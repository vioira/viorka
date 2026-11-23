package alerts

import (
	"testing"
	"time"

	v1 "github.com/vioira/viorka/protocol/v1"
)

func TestWindowBoundariesAndRecovery(t *testing.T) {
	start := time.Unix(1800000000, 0)
	r := Rule{ID: "r", Metric: "cpu", Mode: "all", WindowMinutes: 1, Threshold: 85, Enabled: true}
	w := Windows{}
	cfg := v1.DefaultTelemetrySettings()
	sample := func(step int, value *float64) ([]Decision, string) {
		t.Helper()
		at := start.Add(time.Duration(step) * time.Second)
		ds := w.Evaluate([]Rule{r}, v1.TelemetryBatch{NodeID: "n", RunID: "one", Fast: []*v1.TelemetryFast{{Sequence: uint64(step + 1), SampledAt: at, CPUPercent: value}}}, cfg, true, [3]uint64{}, at)
		return ds, w.Readings()["r"].State
	}
	for _, tc := range []struct {
		sec  int
		v    float64
		want string
	}{{0, 100, "insufficient"}, {30, 91, "insufficient"}, {60, 90, "high"}, {90, 85, "mixed"}, {120, 84, "mixed"}, {150, 80, "normal"}, {250, 99, "insufficient"}} {
		ds, status := sample(tc.sec, &tc.v)
		if status != tc.want {
			t.Fatalf("at %d: %s, want %s", tc.sec, status, tc.want)
		}
		if tc.want == "high" && (len(ds) != 1 || ds[0].Value != 90) {
			t.Fatal(ds)
		}
	}
	if ds, _ := sample(280, nil); len(ds) != 0 {
		t.Fatal(ds)
	}
	v := 96.
	if ds, _ := sample(310, &v); len(ds) != 0 {
		t.Fatal("missing sample formed a window")
	}
	r.Mode = "average"
	r.ID = "mean"
	w = Windows{}
	a, b, c := 82., 88., 91.
	sample(0, &a)
	sample(30, &b)
	ds, _ := sample(60, &c)
	if len(ds) != 1 || ds[0].Value != 87 || !ds[0].High {
		t.Fatal(ds)
	}
}
func TestMonthlyUsesAppliedDirectionAndExactBytes(t *testing.T) {
	now := time.Now()
	rx, tx := uint64(9007199254740992), uint64(3)
	f := v1.TelemetryFast{SampledAt: now, Traffic: &v1.TelemetryTraffic{MonthStart: now.Add(-time.Hour), RXBytes: &rx, TXBytes: &tx}}
	r := Rule{Metric: "monthly", Mode: "percent", Threshold: 100}
	c := v1.TelemetryTrafficSettings{BillingMode: "inbound", QuotaBytes: "9007199254740993"}
	if d, ok := monthly(r, &f, &c, now); !ok || d.High {
		t.Fatalf("rounded bytes crossed quota: %+v", d)
	}
	c.BillingMode = "both"
	if d, _ := monthly(r, &f, &c, now); !d.High {
		t.Fatal(d)
	}
	c.QuotaBytes = "0"
	if _, ok := monthly(r, &f, &c, now); ok {
		t.Fatal("infinite quota")
	}
	r.Mode = "gb"
	r.Threshold = 1
	c.BillingMode = "outbound"
	if d, ok := monthly(r, &f, &c, now); !ok || d.High {
		t.Fatal(d)
	}
}

func TestIndependentMetricsAndNodeScope(t *testing.T) {
	cfg := v1.DefaultTelemetrySettings()
	var rules []Rule
	for _, metric := range []string{"cpu", "memory", "disk", "upload", "download", "monthly"} {
		r := Rule{ID: metric, Metric: metric, Enabled: true, Nodes: []string{"target"}, WindowMinutes: 1, Threshold: 0.5, Mode: "average"}
		if metric == "monthly" {
			r.Mode = "gb"
		}
		rules = append(rules, r)
	}
	var w Windows
	start := time.Now()
	var ds []Decision
	for i := 0; i <= 2; i++ {
		now := start.Add(time.Duration(i) * 30 * time.Second)
		n := uint64(42)
		total := uint64(100)
		speed := 2e6
		usage := 76.
		bytes := uint64(250000000)
		b := v1.TelemetryBatch{NodeID: "target", RunID: "r", Fast: []*v1.TelemetryFast{{Sequence: uint64(i + 1), SampledAt: now, CPUPercent: &usage, RamUsed: &n, RamTotal: &total, Interfaces: []*v1.TelemetryInterface{{RXBytesPerSecond: &speed, TXBytesPerSecond: &speed}}, Traffic: &v1.TelemetryTraffic{MonthStart: start, RXBytes: &bytes, TXBytes: &bytes}}}, Full: []*v1.TelemetryFull{{Sequence: uint64(i + 1), SampledAt: now, DiskUsed: &n, DiskAvailable: &n}}}
		ds = w.Evaluate(rules, b, cfg, true, [3]uint64{}, now)
		b.NodeID = "other"
		tmp := Windows{}
		if got := tmp.Evaluate(rules, b, cfg, true, [3]uint64{}, now); len(got) != 0 {
			t.Fatal(got)
		}
	}
	want := map[string]float64{"cpu": 76, "memory": 42, "upload": 2, "download": 2, "disk": 50, "monthly": 0.5}
	for _, d := range ds {
		if !d.High || d.Value != want[d.Rule.Metric] {
			t.Fatal(d)
		}
		delete(want, d.Rule.Metric)
	}
	if len(want) > 0 {
		t.Fatal("missing", want)
	}
}
