package storage

import (
	"github.com/vioira/viorka/internal/proxy"
	v1 "github.com/vioira/viorka/protocol/v1"
)

func wireOutbound(c proxy.OutboundConfig) *v1.EngineOutbound { o := v1.EngineOutbound(c); return &o }
func wireRouting(r *proxy.Routing) *v1.EngineRouting {
	if r == nil {
		return nil
	}
	out := &v1.EngineRouting{OutboundIds: append([]string{}, r.OutboundIds...), Final: r.Final, Sniff: r.Sniff, Rules: []*v1.EngineRouteRule{}}
	for _, rule := range r.Rules {
		if rule == nil {
			out.Rules = append(out.Rules, nil)
			continue
		}
		copy := v1.EngineRouteRule(*rule)
		out.Rules = append(out.Rules, &copy)
	}
	return out
}
