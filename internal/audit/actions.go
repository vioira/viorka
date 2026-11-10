package audit

// ActionLabel returns the Chinese display text without changing the stored action code.
func ActionLabel(action string) string {
	if label, ok := actionLabels[action]; ok {
		return label
	}
	return "未知操作"
}

var actionLabels = map[string]string{
	"node.create":                    "创建节点",
	"node.delete":                    "删除节点",
	"node.enrollment.revoke":         "吊销注册令牌",
	"node.enrollment.renew":          "续期注册令牌",
	"node.enrollment.reset":          "重置节点注册",
	"node.revoke":                    "吊销节点身份",
	"node.settings.update":           "更新节点设置",
	"node.telemetry_settings.update": "更新节点监控设置",
	"task.create":                    "提交节点任务",
	"traffic.calibrate":              "提交流量校准任务",
	"settings.update":                "更新系统设置",
	"password.change":                "修改密码",
	"sessions.revoke":                "吊销全部会话",
	"session.revoke":                 "吊销会话",
	"session.login":                  "登录",
	"session.logout":                 "退出登录",
	"user.invite":                    "创建用户邀请",
	"invitation.accept":              "接受用户邀请",
	"user.remove":                    "移除用户",
	"user.role":                      "更改用户角色",
	"passkey.create":                 "添加通行密钥",
	"passkey.remove":                 "删除通行密钥",
	"protocol_preset.create":         "创建协议预设",
	"protocol_preset.update":         "更新协议预设",
	"outbound.save":                  "保存共享出口",
	"outbound.delete":                "删除共享出口",
	"engine.draft.save":              "保存引擎草稿",
	"engine.access.grant":            "授予引擎管理权限",
	"engine.credentials.export":      "导出引擎凭证",
	"engine.sync":                    "提交引擎同步任务",
	"engine.sync.retry":              "重试引擎同步",
	"backup.delete":                  "删除备份",
	"backup.policy.update":           "更新备份配置",
	"backup.create":                  "创建备份",
	"backup.restore.schedule":        "安排备份恢复",
	"backup.restore.cancel":          "取消备份恢复",
	"engine.recover":                 "恢复托管引擎",
	"engine.install":                 "提交安装引擎任务",
	"engine.upgrade":                 "提交升级引擎任务",
	"engine.start":                   "提交启动引擎任务",
	"engine.stop":                    "提交停止引擎任务",
	"engine.uninstall":               "提交卸载引擎任务",
	"engine.apply":                   "提交应用引擎配置任务",
	"engine.inspect":                 "提交检查引擎任务",
}
