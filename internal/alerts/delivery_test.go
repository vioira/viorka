package alerts

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type captureTransport func(*http.Request) (*http.Response, error)

func (f captureTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestChannelRequestsAndProviderReceipt(t *testing.T) {
	for _, ch := range []Channel{{Kind: "telegram", Target: "-42"}, {Kind: "bark", Target: "https://bark.example"}} {
		client := &http.Client{Transport: captureTransport(func(r *http.Request) (*http.Response, error) {
			if r.Method != "POST" || r.URL.Scheme != "https" || r.URL.RawQuery != "" {
				t.Fatal(r.Method, r.URL)
			}
			var fields map[string]string
			if err := json.NewDecoder(r.Body).Decode(&fields); err != nil {
				t.Fatal(err)
			}
			payload := `{"code":200}`
			if ch.Kind == "telegram" {
				if r.URL.Host != "api.telegram.org" || fields["chat_id"] != "-42" || fields["text"] != "A\nB" {
					t.Fatal(fields)
				}
				payload = `{"ok":true}`
			} else if fields["device_key"] != "test-key" || r.URL.Path != "/push" || fields["body"] != "B" {
				t.Fatal(fields)
			}
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(payload))}, nil
		})}
		if result := Send(context.Background(), client, ch, "test-key", Message{"A", "B"}); !result.Accepted {
			t.Fatal(result)
		}
	}
	ts := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
		io.WriteString(w, `{"message":"never echo test-key"}`)
	}))
	defer ts.Close()
	res := Send(context.Background(), ts.Client(), Channel{Kind: "bark", Target: ts.URL}, "test-key", Message{})
	if res.Accepted || !res.Retry || strings.Contains(res.Detail, "test-key") {
		t.Fatal(res)
	}
}
