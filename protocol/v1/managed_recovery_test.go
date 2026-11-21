package v1

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestRecoveryFrameBudgetBoundToDispatchedTask(t *testing.T) {
	envelope := Message("task.result", "node", "message", TaskReply{TaskID: "recovery", ResourceID: "node", Attempt: 1, State: "succeeded"})
	envelope.CorrelationID = "recovery"
	raw, err := json.Marshal(envelope)
	if err != nil {
		t.Fatal(err)
	}
	large := append(bytes.Repeat([]byte(" "), MaxMessageBytes), raw...)
	if _, err := Parse(large, "node"); err == nil {
		t.Fatal("standard frames must remain bounded")
	}
	if _, err := ParseEngineRecoveryReply(large, "node", "different"); err == nil {
		t.Fatal("unmatched task accepted")
	}
	if _, err := ParseEngineRecoveryReply(large, "node", "recovery"); err != nil {
		t.Fatal(err)
	}
	if _, err := ParseEngineRecoveryReply(append(large, bytes.Repeat([]byte(" "), MaxEngineRecoveryReplyBytes)...), "node", "recovery"); err == nil {
		t.Fatal("recovery limit ignored")
	}
}
