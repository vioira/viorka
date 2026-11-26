package httpapi

import (
	"context"
	"encoding/json"

	"github.com/vioira/viorka/internal/monitoring"
)

// Each detail connection owns a cursor. The shared feed drives its flushes and Agent demand.
type statusTrendStream struct {
	cursor  monitoring.Cursor
	windows *monitoring.MetricTrendWindows
}

func (s *statusTrendStream) attach(ctx context.Context, a *api, node string, frame *statusFrame) error {
	reset := frame.event == "snapshot"
	if reset {
		*s = statusTrendStream{}
	}
	if a.Gateway == nil {
		return nil
	}
	value, err := a.Gateway.ReadMetrics(node, s.cursor, false)
	if err != nil {
		return err
	}
	value, err = a.metricTrends(ctx, node, value, &s.windows, reset)
	if err != nil {
		return err
	}
	s.cursor = monitoring.Cursor{Generation: value.Generation, Sequence: value.Sequence}
	if reset {
		page := frame.value.(StatusPage)
		page.Nodes[0].MetricTrends = value.MetricTrends
		frame.value = page
		return nil
	}
	for key, chart := range value.MetricTrends {
		if !chart.Reset && len(chart.Points) == 0 && len(chart.RemovedIDs) == 0 {
			delete(value.MetricTrends, key)
		}
	}
	if len(value.MetricTrends) == 0 {
		return nil
	}
	raw, err := json.Marshal(value.MetricTrends)
	if err != nil {
		return err
	}
	d := frame.value.(statusDelta)
	if d.Nodes == nil {
		d.Nodes = map[string]map[string]json.RawMessage{node: {}}
	}
	d.Nodes[node]["metric_trends"] = raw
	frame.value = d
	return nil
}
