package httpapi

import (
	"github.com/vioira/viorka/internal/scheduler"
	"testing"
)

func TestTaskResponseOperationNames(t *testing.T) {
	for operation, name := range map[string]string{
		"node.inspect":      "检查节点",
		"traffic.calibrate": "校准节点流量",
		"engine.install":    "安装引擎",
		"engine.upgrade":    "升级引擎",
		"engine.start":      "启动引擎",
		"engine.stop":       "停止引擎",
		"engine.uninstall":  "卸载引擎",
		"engine.apply":      "应用引擎配置",
		"engine.inspect":    "检查引擎",
		"future.operation":  "future.operation",
	} {
		t.Run(operation, func(t *testing.T) {
			got := taskResponse(scheduler.Task{ID: "task", Operation: operation})
			if got.OperationName != name || got.Operation != operation || got.ID != "task" {
				t.Fatalf("unexpected task response: %+v", got)
			}
		})
	}
}
