package geoip

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/vioira/viorka/internal/inventory"
)

type localResult struct {
	location inventory.Location
	err      error
}

func (r localResult) Lookup(string) (inventory.Location, error) { return r.location, r.err }

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestIPInfoFallback(t *testing.T) {
	for _, test := range []struct {
		name, ip, token, body string
		local                 inventory.LocationResolver
		status                int
		want                  inventory.Location
		calls                 int
		wantErr               bool
	}{
		{name: "local hit", ip: "8.8.8.8", local: localResult{location: inventory.Location{CountryCode: "US"}}, want: inventory.Location{CountryCode: "US"}},
		{name: "local error", ip: "8.8.8.8", local: localResult{err: errors.New("corrupt")}, wantErr: true},
		{name: "anonymous miss", ip: "8.8.8.8", local: localResult{}, status: 200, body: `{"country":"US","region":"California","city":"Mountain View","org":"unused"}`, calls: 1, want: inventory.Location{CountryCode: "US", Subdivision: "California", City: "Mountain View"}},
		{name: "token IPv6 without local database", ip: "2606:4700:4700::1111", token: "secret", status: 200, body: `{"country":"AU"}`, calls: 1, want: inventory.Location{CountryCode: "AU"}},
		{name: "private", ip: "10.0.0.1"},
		{name: "invalid", ip: "../json"},
		{name: "empty IP"},
		{name: "missing country", ip: "8.8.8.8", status: 200, body: `{"city":"Unknown"}`, calls: 1},
		{name: "rate limit", ip: "8.8.8.8", status: 429, calls: 1, wantErr: true},
		{name: "unauthorized", ip: "8.8.8.8", status: 401, calls: 1, wantErr: true},
		{name: "redirect", ip: "8.8.8.8", status: 302, calls: 1, wantErr: true},
		{name: "bad JSON", ip: "8.8.8.8", status: 200, body: `<html>`, calls: 1, wantErr: true},
		{name: "API error", ip: "8.8.8.8", status: 200, body: `{"error":{"message":"secret"}}`, calls: 1, wantErr: true},
		{name: "bad country", ip: "8.8.8.8", status: 200, body: `{"country":"United States"}`, calls: 1, wantErr: true},
		{name: "large response", ip: "8.8.8.8", status: 200, body: strings.Repeat("x", 65537), calls: 1, wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := NewIPInfoFallback(test.local, test.token)
			calls := 0
			r.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.URL.String() != "https://ipinfo.io/"+test.ip+"/json" {
					t.Fatalf("unexpected URL: %s", req.URL)
				}
				wantAuth := ""
				if test.token != "" {
					wantAuth = "Bearer " + test.token
				}
				if req.Header.Get("Authorization") != wantAuth {
					t.Fatal("unexpected authorization")
				}
				return &http.Response{StatusCode: test.status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(test.body)), Request: req}, nil
			})
			got, err := r.LookupContext(context.Background(), test.ip)
			if got != test.want || (err != nil) != test.wantErr || calls != test.calls {
				t.Fatalf("location=%+v err=%v calls=%d", got, err, calls)
			}
			if err != nil && strings.Contains(err.Error(), "secret") {
				t.Fatal("response leaked")
			}
		})
	}
}

func TestIPInfoCancellation(t *testing.T) {
	r := NewIPInfoFallback(nil, "")
	ctx, cancel := context.WithCancel(context.Background())
	r.client.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		cancel()
		<-req.Context().Done()
		return nil, req.Context().Err()
	})
	if _, err := r.LookupContext(ctx, "8.8.8.8"); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation lost: %v", err)
	}
}
