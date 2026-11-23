package httpapi

import (
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/alerts"
)

func TestAlertSettingsAdminAndValidation(t *testing.T) {
	const path = "/api/v1/settings/notifications"
	f := setup(t, "admin")
	enableSettings(t, f)
	expectStatus(t, f.request("GET", path, nil, false), 401)
	v := decodeResponse[alerts.View](t, f.request("GET", path, nil, true), 200)
	edit := alerts.Edit{Config: v.Config}
	edit.Config.Timezone = "invalid/zone"
	expectStatus(t, f.request("PUT", path, edit, true), 400)
	edit.Config.Timezone = "Asia/Shanghai"
	saved := decodeResponse[alerts.View](t, f.request("PUT", path, edit, true), 200)
	if saved.Config.Revision != 2 {
		t.Fatal(saved)
	}
	expectStatus(t, f.request("PUT", path, edit, true), 409)
	expectStatus(t, f.request("POST", path+"/channels/missing/test", nil, true), 404)
	for _, role := range []string{"viewer", "operator"} {
		g := setup(t, role)
		enableSettings(t, g)
		expectStatus(t, g.request("GET", path, nil, true), 403)
		expectStatus(t, g.request("PUT", path, edit, true), 403)
		expectStatus(t, g.request("POST", path+"/channels/x/test", nil, true), 403)
	}
}

func TestOfflineTemplatePreview(t *testing.T) {
	f := setup(t, "admin")
	enableSettings(t, f)
	const path = "/api/v1/settings/notifications"
	view := decodeResponse[alerts.View](t, f.request("GET", path, nil, true), 200)
	for _, template := range view.Config.Templates {
		if template.ID != view.Config.Rules[0].Template {
			continue
		}
		p := AlertPreviewRequest{Template: template, Timezone: "Asia/Shanghai"}
		got := decodeResponse[AlertPreview](t, f.request("POST", path+"/preview", p, true), 200)
		if got.Trigger.Title != "⚠️ 示例节点 已离线" || !strings.HasPrefix(got.Trigger.Body, "离线已达 5 分钟。\n触发时间　") ||
			got.Repeat.Title != "⏳ 示例节点 仍处于离线状态" || !strings.HasPrefix(got.Repeat.Body, "已离线 15 分钟。\n提醒时间　") ||
			got.Recovery.Title != "✅ 示例节点 已重新上线" || !strings.HasPrefix(got.Recovery.Body, "本次离线持续 18 分钟。\n恢复时间　") || !strings.Contains(got.Recovery.Body, "+08:00") {
			t.Fatal(got)
		}
		return
	}
	t.Fatal("missing built-in offline template")
}
