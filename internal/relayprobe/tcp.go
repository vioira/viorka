// Package relayprobe verifies the TCP endpoint of a published managed relay.
package relayprobe

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/vioira/viorka/internal/proxy"
	v1 "github.com/vioira/viorka/protocol/v1"
)

// Target contains the independent node inventory or matching TCP allocation
// that authorizes the published endpoint. A registered hostname allocation
// delegates address resolution for exactly this host and port.
type Target struct {
	Endpoint       proxy.Endpoint
	Addresses      []netip.Addr
	AllocatedHost  bool
	EntryAddresses []netip.Addr
}

type Result struct {
	State, Detail, Source string
	IP                    netip.Addr
}

type Checker struct {
	source     string
	lookup     func(context.Context, string, string) ([]netip.Addr, error)
	interfaces func() ([]net.Addr, error)
	connect    func(context.Context, string) (string, string)
}

func New(source, authPath string) (*Checker, error) {
	c := &Checker{lookup: net.DefaultResolver.LookupNetIP, interfaces: net.InterfaceAddrs}
	switch source {
	case "", "panel":
		if authPath != "" {
			return nil, errors.New("relay probe authorization file requires an HTTPS probe source")
		}
		c.source = source
		c.connect = direct
	default:
		u, err := url.Parse(source)
		if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Path != "" || u.ForceQuery || u.RawQuery != "" || u.Fragment != "" || authPath == "" {
			return nil, errors.New("relay probe source must be panel or an HTTPS origin with a authorization file")
		}
		raw, err := os.ReadFile(authPath)
		if err != nil {
			return nil, errors.New("cannot read relay probe authorization file")
		}
		authorization := strings.TrimSpace(string(raw))
		scheme, credential, _ := strings.Cut(authorization, " ")
		if (scheme != "Basic" && scheme != "Bearer") || len(credential) == 0 || len(credential) > 4096 || strings.IndexFunc(credential, func(r rune) bool { return r < 33 || r > 126 }) >= 0 {
			return nil, errors.New("invalid relay probe authorization")
		}
		c.source = "external"
		// No environment proxy, redirects or credentials in a URL. CONNECT is
		// addressed to the vetted numeric IP, so the probe point never resolves it.
		transport := &http.Transport{DisableKeepAlives: true, MaxResponseHeaderBytes: 8192}
		c.connect = func(ctx context.Context, addr string) (string, string) {
			return connectHTTPS(ctx, transport, source, authorization, addr)
		}
	}
	return c, nil
}

func connectHTTPS(ctx context.Context, transport *http.Transport, source, authorization, addr string) (string, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodConnect, source, nil)
	if err != nil {
		return "unavailable", "probe_connection"
	}
	req.Host = addr
	req.Header.Set("Proxy-Authorization", authorization)
	res, err := transport.RoundTrip(req)
	if err != nil {
		return "unavailable", "probe_connection"
	}
	res.Body.Close()
	switch {
	case res.StatusCode >= 200 && res.StatusCode < 300:
		return "passed", ""
	case res.StatusCode == http.StatusGatewayTimeout:
		return "failed", "timeout"
	case res.StatusCode == http.StatusBadGateway:
		return "failed", "unreachable"
	default:
		return "unavailable", "probe_rejected"
	}
}

func direct(ctx context.Context, addr string) (string, string) {
	conn, err := new(net.Dialer).DialContext(ctx, "tcp", addr)
	if err == nil {
		conn.Close()
		return "passed", ""
	}
	var ne net.Error
	switch {
	case errors.Is(err, syscall.ECONNREFUSED):
		return "failed", "refused"
	case errors.As(err, &ne) && ne.Timeout():
		return "failed", "timeout"
	default:
		return "failed", "unreachable"
	}
}

func publicIP(ip netip.Addr) bool {
	if !v1.PublicAddress(ip.String(), ip.Is4()) {
		return false
	}
	for _, prefix := range []string{"192.88.99.0/24", "168.63.129.16/32", "2001::/23", "3fff::/20"} {
		if netip.MustParsePrefix(prefix).Contains(ip) {
			return false
		}
	}
	return true
}

func (t Target) Allows(ip netip.Addr) bool {
	return publicIP(ip) && (t.AllocatedHost || slices.Contains(t.Addresses, ip))
}

func (c *Checker) Check(parent context.Context, t Target) Result {
	ctx, cancel := context.WithTimeout(parent, 12*time.Second)
	defer cancel()
	result := Result{State: "unavailable", Detail: "source_missing", Source: c.source}
	if c.source == "" {
		return result
	}
	result.State, result.Detail = "failed", "target_not_authorized"
	if t.Endpoint.Port < 1 || t.Endpoint.Port > 65535 || (!t.AllocatedHost && len(t.Addresses) == 0) {
		return result
	}
	ip, err := netip.ParseAddr(t.Endpoint.Host)
	ips := []netip.Addr{ip}
	if err != nil {
		host := strings.ToLower(strings.TrimSuffix(t.Endpoint.Host, "."))
		if !strings.Contains(host, ".") || strings.ContainsAny(host, "%:/") {
			return result
		}
		for _, suffix := range []string{".localhost", ".local", ".internal", ".arpa", ".onion"} {
			if strings.HasSuffix(host, suffix) {
				return result
			}
		}
		dns, stop := context.WithTimeout(ctx, 3*time.Second)
		ips, err = c.lookup(dns, "ip", host+".")
		stop()
		if err != nil || len(ips) == 0 {
			result.Detail = "dns"
			return result
		}
	}
	if len(ips) > 32 {
		return result
	}
	for i, ip := range ips {
		ips[i] = ip.Unmap()
		if !t.Allows(ips[i]) {
			return result
		}
	}
	if c.source == "panel" {
		addrs, err := c.interfaces()
		if err != nil {
			return Result{State: "unavailable", Detail: "source_network", Source: c.source}
		}
		entryAddresses := append(slices.Clone(ips), t.EntryAddresses...)
		for _, addr := range addrs {
			if prefix, err := netip.ParsePrefix(addr.String()); err == nil {
				for _, ip := range entryAddresses {
					if prefix.Contains(ip) {
						return Result{State: "unavailable", Detail: "source_network", Source: c.source}
					}
				}
			}
		}
	}
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return result
			case <-time.After(300 * time.Millisecond):
			}
		}
		for _, ip := range ips[:min(4, len(ips))] {
			if ctx.Err() != nil {
				return result
			}
			dial, stop := context.WithTimeout(ctx, 2500*time.Millisecond)
			result.State, result.Detail = c.connect(dial, net.JoinHostPort(ip.String(), strconv.Itoa(t.Endpoint.Port)))
			stop()
			if result.State == "passed" {
				result.IP = ip
				return result
			}
			if result.State == "unavailable" {
				break
			}
		}
	}
	return result
}
