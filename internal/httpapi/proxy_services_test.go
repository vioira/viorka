package httpapi

import "testing"

func TestProxyServicesRoute(t *testing.T) {
	f := setup(t, "viewer")
	const path = "/api/v1/proxy/services"
	expectStatus(t, f.request("GET", path, nil, false), 401)
	expectStatus(t, f.request("GET", path+"?limit=1&selected=eng%2Fsvc", nil, true), 200)
	for _, query := range []string{"limit=51", "status=unknown", "after=invalid", "selected=e%2Fs%2Fextra", "access=private", "q=a&q=b", "unsupported=1", "q=%0A"} {
		expectStatus(t, f.request("GET", path+"?"+query, nil, true), 400)
	}
}
