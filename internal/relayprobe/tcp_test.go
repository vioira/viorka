package relayprobe

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
	"time"

	"github.com/vioira/viorka/internal/proxy"
)

func TestPublicProbeValidatesEveryAnswerAndPinsDial(t *testing.T) {
	ip := netip.MustParseAddr("93.184.216.34")
	target := Target{Endpoint: proxy.Endpoint{Host: "ingress.example", Port: 30443}, Addresses: []netip.Addr{ip}}
	c, err := New("panel", "")
	if err != nil {
		t.Fatal(err)
	}
	c.interfaces = func() ([]net.Addr, error) { return nil, nil }
	calls, lookups := 0, 0
	c.connect = func(ctx context.Context, address string) (string, string) {
		if deadline, ok := ctx.Deadline(); !ok || time.Until(deadline) > 3*time.Second || address != "93.184.216.34:30443" {
			t.Fatalf("unbounded or unpinned dial %s", address)
		}
		calls++
		if calls == 1 {
			return "failed", "refused"
		}
		return "passed", ""
	}
	c.lookup = func(_ context.Context, _, host string) ([]netip.Addr, error) {
		lookups++
		if host != "ingress.example." {
			t.Fatal(host)
		}
		return []netip.Addr{ip}, nil
	}
	if r := c.Check(t.Context(), target); r.State != "passed" || r.IP != ip || calls != 2 || lookups != 1 {
		t.Fatal(r, calls, lookups)
	}
	c.connect = func(context.Context, string) (string, string) { t.Fatal("unauthorized dial"); return "", "" }
	for _, raw := range []string{"127.0.0.1", "::ffff:10.0.0.1", "169.254.169.254", "100.64.0.1", "192.0.2.1", "64:ff9b::a00:1", "2002:7f00:1::", "3fff::1", "224.0.0.1", "8.8.8.8"} {
		c.lookup = func(context.Context, string, string) ([]netip.Addr, error) {
			return []netip.Addr{ip, netip.MustParseAddr(raw)}, nil
		}
		if r := c.Check(t.Context(), target); r.Detail != "target_not_authorized" {
			t.Fatal(raw, r)
		}
	}
	c.lookup = func(context.Context, string, string) ([]netip.Addr, error) {
		return nil, errors.New("resolver offline")
	}
	if r := c.Check(t.Context(), target); r.Detail != "dns" {
		t.Fatal(r)
	}
	c.lookup = func(context.Context, string, string) ([]netip.Addr, error) {
		t.Fatal("internal DNS lookup")
		return nil, nil
	}
	target.Endpoint.Host = "printer.local"
	if r := c.Check(t.Context(), target); r.Detail != "target_not_authorized" {
		t.Fatal(r)
	}
	target.Endpoint.Host = ip.String()
	c.interfaces = func() ([]net.Addr, error) {
		_, network, err := net.ParseCIDR("93.184.216.1/24")
		return []net.Addr{network}, err
	}
	if r := c.Check(t.Context(), target); r.State != "unavailable" || r.Detail != "source_network" {
		t.Fatal(r)
	}
}

func TestExternalProbeAuthenticatedPinnedCONNECT(t *testing.T) {
	const endpoint = "[2606:4700:4700::1111]:30443"
	for _, tc := range []struct {
		code          int
		state, detail string
	}{{200, "passed", ""}, {502, "failed", "unreachable"}, {504, "failed", "timeout"}, {407, "unavailable", "probe_rejected"}, {302, "unavailable", "probe_rejected"}} {
		server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != "CONNECT" || r.Host != endpoint || r.RequestURI != endpoint || r.Header.Get("Proxy-Authorization") != "Bearer test-credential" {
				t.Error("wrong CONNECT authority or authorization")
			}
			w.WriteHeader(tc.code)
		}))
		ctx, cancel := context.WithTimeout(t.Context(), time.Second)
		state, detail := connectHTTPS(ctx, server.Client().Transport.(*http.Transport), server.URL, "Bearer test-credential", endpoint)
		cancel()
		server.Close()
		if state != tc.state || detail != tc.detail {
			t.Fatal(tc, state, detail)
		}
	}
}
