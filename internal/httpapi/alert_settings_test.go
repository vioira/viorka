package httpapi

import (
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
