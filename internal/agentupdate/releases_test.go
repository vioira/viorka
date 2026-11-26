package agentupdate

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type transport func(*http.Request) (*http.Response, error)

func (t transport) RoundTrip(r *http.Request) (*http.Response, error) { return t(r) }

func TestReleaseAssetsRequireStableTagDigestAndSignature(t *testing.T) {
	payload := `{"tag_name":"v2.3.4","assets":[{"name":"viorka-agent-linux-arm64","digest":"sha256:` + strings.Repeat("b", 64) + `"},{"name":"viorka-agent-linux-arm64.sig"},{"name":"viorka-agent-linux-amd64","digest":"sha256:` + strings.Repeat("a", 64) + `"}]}`
	client := &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() != "https://api.github.com/repos/vioira/viorka-agent/releases/latest" {
			t.Fatal(r.URL)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(payload))}, nil
	})}
	values, err := fetch(context.Background(), client)
	if err != nil || len(values) != 1 || !values["arm64"].NewerThan("2.3.4-rc.1") {
		t.Fatal(values, err)
	}
	payload = strings.Replace(payload, "v2.3.4", "v2.3.4-rc.2", 1)
	values, err = fetch(context.Background(), client)
	if err != nil || len(values) != 0 {
		t.Fatal(values, err)
	}
}
