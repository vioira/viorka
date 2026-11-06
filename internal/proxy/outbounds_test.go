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
