package alerts

import "slices"

func dutyNotice() Template {
	const reading = "{metric}（{basis}）{value}，阈值 {threshold}。"
	return Template{
		ID: DefaultTemplate, Name: "通用值班通知",
		Trigger:  Message{"⚠️ 告警｜{node}｜{rule}", reading + "\n触发时间　{time}"},
		Repeat:   Message{"⏳ 持续告警｜{node}｜{rule}", "告警已持续 {duration_zh}。\n" + reading + "\n提醒时间　{time}"},
		Recovery: Message{"✅ 已恢复｜{node}｜{rule}", "本次告警持续 {duration_zh}。\n恢复时间　{time}"},
	}
}

func offlineNotice() Template {
	return Template{
		ID: OfflineTemplate, Name: "节点离线通知",
		Trigger:  Message{"⚠️ {node} 已离线", "离线已达 {window}。\n触发时间　{time}"},
		Repeat:   Message{"⏳ {node} 仍处于离线状态", "已离线 {duration_zh}。\n提醒时间　{time}"},
		Recovery: Message{"✅ {node} 已重新上线", "本次离线持续 {duration_zh}。\n恢复时间　{time}"},
	}
}

// UpgradeLegacyTemplates preserves edited templates and explicit rule bindings.
func (c *Config) UpgradeLegacyTemplates() {
	const body = "{node}，{metric}，{basis} {value}，阈值 {threshold}。\n{time}"
	legacy := Template{ID: DefaultTemplate, Name: "默认通知",
		Trigger: Message{"告警：{rule}", body}, Repeat: Message{"持续告警：{rule}", body},
		Recovery: Message{"已恢复：{rule}", "{node}，{metric}已恢复，持续 {duration}。\n{time}"},
	}
	i := slices.Index(c.Templates, legacy)
	if i >= 0 {
		c.Templates[i] = dutyNotice()
	}
	if len(c.Templates) >= maxTemplates || slices.ContainsFunc(c.Templates, func(t Template) bool { return t.ID == OfflineTemplate }) {
		return
	}
	c.Templates = append(c.Templates, offlineNotice())
	if i >= 0 {
		for j, r := range c.Rules {
			if r.ID == Builtin && r.Template == DefaultTemplate {
				c.Rules[j].Template = OfflineTemplate
			}
		}
	}
}
