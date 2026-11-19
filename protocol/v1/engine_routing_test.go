package v1

import (
	"slices"
	"strings"
	"testing"
)

func TestRoutingValidation(t *testing.T) {
	base := func() EngineCommand {
		return EngineCommand{Name: "sing-box", Version: "1.14.4", Revision: 1, RunIntent: "stopped", Outbounds: []*EngineOutbound{{ID: "exit", Name: "Exit", Type: "socks", Server: "example.com", ServerPort: 1080}}, Routing: &EngineRouting{OutboundIds: []string{"exit"}, Final: "exit", Rules: []*EngineRouteRule{{ID: "rule", Name: "Rule", Enabled: true, DomainSuffix: []string{"example.com"}, Outbound: "exit"}}}}
	}
	if err := base().Validate("engine.apply"); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*EngineCommand){func(c *EngineCommand) { c.Name = "xray" }, func(c *EngineCommand) { c.Routing.Final = "missing" }, func(c *EngineCommand) { c.Routing.OutboundIds = []string{"exit", "exit"} }, func(c *EngineCommand) { c.Routing.Rules[0].Inbound = []string{"missing"} }, func(c *EngineCommand) { c.Routing.Rules[0].DomainSuffix = nil }, func(c *EngineCommand) { c.Routing.Rules[0].PortRange = []string{"65535:65536"} }, func(c *EngineCommand) { c.Routing.Rules[0].IpCidr = []string{"bad"} }, func(c *EngineCommand) { c.Outbounds[0].Type = "http" }, func(c *EngineCommand) { c.Routing.Rules[0].MatchAll = true }} {
		c := base()
		change(&c)
		if c.Validate("engine.apply") == nil {
			t.Fatal("invalid routing accepted")
		}
	}
	c := base()
	c.Outbounds[0].Type = "http"
	c.Routing.Final = "direct"
	c.Routing.Rules[0].Network = []string{"tcp"}
	if err := c.Validate("engine.apply"); err != nil {
		t.Fatal(err)
	}
	if c.Validate("engine.start") == nil {
		t.Fatal("lifecycle accepted routing payload")
	}
}

func TestRoutingGeoConditions(t *testing.T) {
	for _, tc := range []struct {
		name       string
		ip, site   []string
		all, valid bool
	}{
		{name: "GeoIP only", ip: []string{"cn", "private", "custom_group-2"}, valid: true},
		{name: "GeoSite only", site: []string{"a", "apple@cn", "geolocation-!cn"}, valid: true},
		{name: "combined", ip: []string{"cn"}, site: []string{"cn"}, valid: true},
		{name: "all traffic", all: true, valid: true},
		{name: "empty conditions"},
		{name: "all with GeoIP", ip: []string{"cn"}, all: true},
		{name: "all with GeoSite", site: []string{"cn"}, all: true},
		{name: "short GeoIP", ip: []string{"c"}},
		{name: "long GeoIP", ip: []string{strings.Repeat("a", 33)}},
		{name: "uppercase GeoIP", ip: []string{"CN"}},
		{name: "GeoIP URL delimiter", ip: []string{"a@cn"}},
		{name: "empty GeoSite code", site: []string{""}},
		{name: "uppercase GeoSite", site: []string{"Apple@cn"}},
		{name: "long GeoSite", site: []string{strings.Repeat("a", 65)}},
		{name: "GeoSite URL delimiter", site: []string{"../cn"}},
		{name: "GeoSite whitespace", site: []string{"cn\n"}},
		{name: "maximum lengths", ip: []string{strings.Repeat("a", 32)}, site: []string{strings.Repeat("a", 64)}, valid: true},
		{name: "maximum count", ip: slices.Repeat([]string{"cn"}, 64), site: slices.Repeat([]string{"cn"}, 64), valid: true},
		{name: "too many GeoIP codes", ip: slices.Repeat([]string{"cn"}, 65)},
		{name: "too many GeoSite codes", site: slices.Repeat([]string{"cn"}, 65)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := EngineRouting{Final: "direct", Rules: []*EngineRouteRule{
				{ID: "rule", Name: "Rule", Enabled: true, Outbound: "direct", Geoip: tc.ip, Geosite: tc.site, MatchAll: tc.all},
			}}
			if err := r.Validate(nil); (err == nil) != tc.valid {
				t.Fatalf("Validate() = %v, want valid=%v", err, tc.valid)
			}
		})
	}
}
