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
