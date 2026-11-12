package v1

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func TestTCPProbeContract(t *testing.T) {
	raw, err := os.ReadFile("../../api/agent/v1/examples/node.metrics.v3.tcp_probe.json")
	if err != nil {
		t.Fatal(err)
	}
	var e Envelope
	if err = json.Unmarshal(raw, &e); err != nil {
		t.Fatal(err)
	}
	var b TelemetryBatch
	if err = json.Unmarshal(e.Payload, &b); err != nil {
		t.Fatal(err)
	}
	now := b.Full[0].SampledAt
	if _, err = DecodeTelemetryBatch(e.Payload, b.NodeID, now, 60, true); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*TelemetryTCPProbeBatch){
		func(p *TelemetryTCPProbeBatch) { p.Targets[0].Loss = 101 },
		func(p *TelemetryTCPProbeBatch) { p.Targets[0].Ping = -0.5 },
		func(p *TelemetryTCPProbeBatch) { p.Targets[0].Ping = -1 },
		func(p *TelemetryTCPProbeBatch) { p.Targets[0].Loss = 100 },
		func(p *TelemetryTCPProbeBatch) { p.SampledAt = now.Add(time.Second) },
		func(p *TelemetryTCPProbeBatch) { p.SampledAt = now.Add(-120 * time.Second) },
		func(p *TelemetryTCPProbeBatch) { p.Targets[0].Target = "https://example.com" },
		func(p *TelemetryTCPProbeBatch) { p.Targets = append(p.Targets, p.Targets[0]) },
	} {
		probe := *b.Full[0].TcpProbes.Targets[0]
		batch := *b.Full[0].TcpProbes
		batch.Targets = []*TelemetryTCPProbe{&probe}
		change(&batch)
		full := *b.Full[0]
		full.TcpProbes = &batch
		bad := b
		bad.Full = []*TelemetryFull{&full}
		raw, _ := json.Marshal(bad)
		if _, err := DecodeTelemetryBatch(raw, b.NodeID, now, 60, true); err == nil {
			t.Error("invalid probe accepted")
		}
	}

	b.Full[0].TcpProbes = nil
	old, _ := json.Marshal(b)
	if _, err = DecodeTelemetryBatch(old, b.NodeID, now, 60, true); err != nil {
		t.Fatal("unextended v3 rejected", err)
	}
}

func TestTCPProbeNames(t *testing.T) {
	for _, names := range [][]string{{"香港", "多余名称"}, {" 前导空格"}} {
		settings := DefaultTelemetrySettings()
		settings.TcpProbe = &TelemetryTCPProbeSettings{Targets: []string{"example.com:443"}, Names: names}
		if settings.Validate() == nil {
			t.Fatal("invalid names accepted", names)
		}
	}
	settings := DefaultTelemetrySettings()
	settings.TcpProbe = &TelemetryTCPProbeSettings{Targets: []string{"example.com:443"}, Names: []string{"香港"}}
	raw, err := json.Marshal(settings)
	if err != nil {
		t.Fatal(err)
	}
	if err = ValidateTelemetryJSON(raw, "TelemetrySettings", true); err != nil {
		t.Fatal(err)
	}
	if err = settings.Validate(); err != nil {
		t.Fatal(err)
	}
}
