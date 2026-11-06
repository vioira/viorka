package audit

import "testing"

func TestActionLabel(t *testing.T) {
	for _, tc := range []struct{ action, want string }{
		{"session.login", "登录"},
		{"node.enrollment.reset", "重置节点注册"},
		{"node.telemetry_settings.update", "更新节点监控设置"},
		{"engine.apply", "提交应用引擎配置任务"},
		{"engine.sync", "提交引擎同步任务"},
		{"traffic.calibrate", "提交流量校准任务"},
		{"backup.restore.schedule", "安排备份恢复"},
		{"protocol_preset.update", "更新协议预设"},
		{"outbound.save", "保存共享出口"},
		{"future.action", "未知操作"},
		{"", "未知操作"},
	} {
		t.Run(tc.action, func(t *testing.T) {
			if got := ActionLabel(tc.action); got != tc.want {
				t.Fatalf("ActionLabel(%q) = %q, want %q", tc.action, got, tc.want)
			}
		})
	}
}
