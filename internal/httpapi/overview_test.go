package httpapi

import (
	"encoding/json"
	"github.com/vioira/viorka/internal/inventory"
	"testing"
)

func TestOverviewRoutes(t *testing.T) {
	f := setup(t, "viewer")
	for _, test := range []struct {
		path   string
		auth   bool
		status int
	}{
		{"/api/v1/overview", false, 401},
		{"/api/v1/overview", true, 200},
		{"/api/v1/overview?unexpected=1", true, 400},
		{"/api/v1/overview/traffic?range=week&timezone=Asia%2FShanghai", true, 200},
		{"/api/v1/overview/traffic?range=invalid", true, 400},
		{"/api/v1/overview/traffic?range=week&range=day", true, 400},
		{"/api/v1/overview/traffic?range=week&timezone=invalid", true, 400},
		{"/api/v1/overview/traffic?range=week", false, 401},
	} {
		res := f.request("GET", test.path, nil, test.auth)
		if res.StatusCode != test.status {
			t.Fatalf("%s: %d %s", test.path, res.StatusCode, read(res))
		}
		res.Body.Close()
	}
	res := f.request("GET", "/api/v1/overview", nil, true)
	defer res.Body.Close()
	var result inventory.Overview
	if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Nodes != 0 || result.Tasks.SuccessRate != nil || result.Attention == nil {
		t.Fatalf("empty: %+v", result)
	}
}
