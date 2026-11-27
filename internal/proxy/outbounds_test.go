package proxy

import (
	"strings"
	"testing"
)

func TestParseOutboundLink(t *testing.T) {
	link := "vless://12345678-1234-4234-8234-123456789012@[2001:db8::1]:443?type=tcp&security=reality&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=aabb&sni=example.com&fp=chrome&flow=xtls-rprx-vision#Hong%20Kong"
	c, err := ParseOutboundLink(link)
	if err != nil || c.Name != "Hong Kong" || c.Server != "2001:db8::1" || c.ShortID != "aabb" || c.ID != "" {
		t.Fatal("valid import failed", err)
	}
	for _, raw := range []string{strings.Replace(link, "type=tcp", "type=ws", 1), link + "%00", strings.Replace(link, "security=reality", "security=tls", 1), strings.Replace(link, "&sid=aabb", "&sid=aabb&sid=cc", 1), strings.Replace(link, "&sid=aabb", "&unknown=true", 1), strings.Replace(link, "12345678-1234-4234-8234-123456789012", "bad", 1), strings.Replace(link, ":443?", ":99999?", 1), "vless://1d4137aa-5....."} {
		if _, err := ParseOutboundLink(raw); err == nil {
			t.Fatal("invalid link accepted")
		}
	}
}

func TestParsePlainVLESSOutbound(t *testing.T) {
	base := "vless://12345678-1234-4234-8234-123456789012@example.com:443"
	for _, query := range []string{"", "?security=none&type=tcp&encryption=none", "?type=raw"} {
		c, err := ParseOutboundLink(base + query)
		if err != nil || c.Tls || c.Fingerprint != "" || c.Flow != "" || c.Uuid == "" {
			t.Fatalf("plain TCP import: %+v %v", c, err)
		}
	}
	for _, query := range []string{"?security=none&flow=xtls-rprx-vision", "?security=none&fp=chrome", "?security=none&sni=example.com", "?pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "?sid=aabb", "?security=tls", "?type=ws", "?security=none&security=reality"} {
		if _, err := ParseOutboundLink(base + query); err == nil {
			t.Fatalf("accepted incompatible parameters: %s", query)
		}
	}
}

func TestRealityShareOptions(t *testing.T) {
	base := "vless://12345678-1234-4234-8234-123456789012@example.com:443?"
	reality := "security=reality&sni=example.org&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&"
	for _, opt := range []string{"spx=%2F", "support-x25519mlkem768=false"} {
		if _, err := ParseOutboundLink(base + reality + opt); err != nil {
			t.Fatalf("rejected %s", opt)
		}
		if _, err := ParseOutboundLink(base + opt); err == nil {
			t.Fatalf("accepted %s without REALITY", opt)
		}
	}
	for _, opt := range []string{"spx=relative", "spx=%2F%00", "support-x25519mlkem768=yes", "spx=/&spx=/", "support-x25519mlkem768=true&support-x25519mlkem768=false", "spx=/&unknown=true"} {
		if _, err := ParseOutboundLink(base + reality + opt); err == nil {
			t.Fatalf("accepted %s", opt)
		}
	}
}

func TestOutboundServerAndTLSName(t *testing.T) {
	for _, tc := range []struct {
		host string
		want bool
	}{
		{"188.239.1", false}, {"256.2.3.4", false}, {"127.000.0.1", false},
		{"2130706433", false}, {"0x7f.1", false}, {"1.2.3.4.5", false},
		{"example.org:443", false}, {"bad_host", false}, {"::", false}, {"ff02::1", false},
		{"188.239.1.1", true}, {"2001:db8::123", true}, {"localhost", true},
		{"123.example.org", true}, {"node-1.example", true},
	} {
		t.Run(tc.host, func(t *testing.T) {
			o := OutboundConfig{ID: "test", Name: "test", Type: "http", Server: tc.host, ServerPort: 443, Tls: true}
			if (o.Validate() == nil) != tc.want {
				t.Fatal("unexpected server validation")
			}
			o.Server, o.ServerName = "example.org", tc.host
			if (o.Validate() == nil) != tc.want {
				t.Fatal("unexpected TLS name validation")
			}
		})
	}
	_, err := ParseOutboundLink("vless://12345678-1234-4234-8234-123456789012@188.239.1:443")
	if err == nil {
		t.Fatal("import accepted an abbreviated IPv4 address")
	}
}

func TestOutboundRejectsMalformedCredentials(t *testing.T) {
	o := OutboundConfig{ID: "test", Name: "test", Type: "vless", Server: "example.org", ServerPort: 443, Uuid: "12345678-1234-4234-8234-1234567890--"}
	if o.Validate() == nil {
		t.Fatal("accepted additional hyphens in UUID")
	}
	o.Uuid = "12345678-1234-4234-8234-123456789012"
	o.Tls, o.ServerName, o.Fingerprint, o.PublicKey = true, "example.org", "chrome", strings.Repeat("A", 43)+"\n"
	if o.Validate() == nil {
		t.Fatal("accepted newline in REALITY public key")
	}
}
