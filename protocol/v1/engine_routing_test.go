package v1

import "testing"

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
