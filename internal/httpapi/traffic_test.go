package httpapi

import (
	"context"
	"github.com/vioira/viorka/internal/scheduler"
	v1 "github.com/vioira/viorka/protocol/v1"
	"testing"
	"time"
)

func TestTrafficSettingsAndCalibrationTask(t *testing.T) {
	f := setup(t, "admin")
	node, _ := f.enroll()
	base := "/api/v1/nodes/" + node
	settings := v1.DefaultTelemetrySettings()
	flow := v1.DefaultTrafficSettings()
	flow.Interfaces = "eth0,eth1"
	flow.ResetDay = 15
	flow.BillingMode = "outbound"
	flow.QuotaBytes = "1073741824000"
	settings.Traffic = &flow
	saved := decodeResponse[v1.TelemetrySettings](t, f.request("PUT", base+"/telemetry-settings", settings, true), 200)
	read := decodeResponse[v1.TelemetrySettings](t, f.request("GET", base+"/telemetry-settings", nil, true), 200)
	if read.Traffic == nil || *read.Traffic != flow || saved.Revision != read.Revision {
		t.Fatal(read)
	}
	bad := saved
	badFlow := flow
	badFlow.ResetDay = 32
	bad.Traffic = &badFlow
	expectStatus(t, f.request("PUT", base+"/telemetry-settings", bad, true), 400)
	start, _ := flow.Period(time.Now())
	req := TrafficCalibrationRequest{IdempotencyKey: "once", Calibration: v1.TrafficCalibration{PeriodStart: start, RXBytes: "123", TXBytes: "456"}}
	task := decodeResponse[scheduler.Task](t, f.request("POST", base+"/traffic-calibrations", req, true), 202)
	req.Calibration.PeriodStart = req.Calibration.PeriodStart.In(time.FixedZone("offset", 19800))
	duplicate := decodeResponse[scheduler.Task](t, f.request("POST", base+"/traffic-calibrations", req, true), 202)
	if task.ID != duplicate.ID || task.State != "queued" || task.Operation != "traffic.calibrate" {
		t.Fatal(task, duplicate)
	}
	req.Calibration.TXBytes = "999"
	expectStatus(t, f.request("POST", base+"/traffic-calibrations", req, true), 409)
	expectStatus(t, f.request("POST", base+"/traffic-calibrations", req, false), 401)
	// Old agents cannot claim calibration tasks; an acknowledged task is not success.
	ctx := context.Background()
	if err := f.store.Online(ctx, node, v1.Hello{OS: "linux", Arch: "amd64", AgentVersion: "test"}); err != nil {
		t.Fatal(err)
	}
	d, err := f.store.Claim(ctx, node)
	if err != nil || d != nil {
		t.Fatal(d, err)
	}
	d, err = f.store.ClaimSupported(ctx, node, true)
	if err != nil || d == nil || d.TrafficCalibration == nil {
		t.Fatal(d, err)
	}
	reply := v1.TaskReply{TaskID: d.TaskID, Attempt: *d.Attempt, ResourceID: node, State: "accepted"}
	if err = f.store.Reply(ctx, node, "task.ack", reply); err != nil {
		t.Fatal(err)
	}
	current, err := f.store.Task(ctx, task.ID)
	if err != nil || current.State != "accepted" {
		t.Fatal(current, err)
	}
	reply.State = "succeeded"
	if f.store.Reply(ctx, node, "task.result", reply) == nil {
		t.Fatal("success without matching result accepted")
	}
	reply.TrafficCalibration = d.TrafficCalibration
	reply.TrafficBefore = &v1.TrafficCalibration{PeriodStart: d.TrafficCalibration.PeriodStart, RXBytes: "0", TXBytes: "0"}
	if err = f.store.Reply(ctx, node, "task.result", reply); err != nil {
		t.Fatal(err)
	}
}
func TestTrafficCalibrationRequiresAdmin(t *testing.T) {
	for _, role := range []string{"viewer", "operator"} {
		t.Run(role, func(t *testing.T) {
			f := setup(t, role)
			expectStatus(t, f.request("POST", "/api/v1/nodes/any/traffic-calibrations", TrafficCalibrationRequest{}, true), 403)
		})
	}
}
