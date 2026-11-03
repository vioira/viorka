import { useEffect, useState } from 'react';
import type { MonitoringSnapshot } from '@/api/monitoring';
import { Button } from '@/components/arc/button/button';
import { metricCharts } from './metric-chart';
import NodeMetricHistory from './NodeMetricHistory';
import TelemetryMonitoring from './TelemetryMonitoring';

export default function NodeMonitoring({
  id,
  active,
  snapshot,
  onRefresh,
}: {
  id: string;
  active: boolean;
  snapshot?: MonitoringSnapshot;
  onRefresh: () => void;
}) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [active]);
  if (snapshot?.telemetry)
    return (
      <TelemetryMonitoring
        id={id}
        active={active}
        snapshot={snapshot}
        telemetry={snapshot.telemetry}
        now={now}
      />
    );

  return (
    <section aria-label="主机监控" className="space-y-4 pt-6">
      <p className="text-text-secondary">
        {snapshot ? '尚未收到监控，请连接支持 telemetry v3 的 Agent。' : '正在读取监控…'}
      </p>
      <Button variant="ghost" onClick={onRefresh}>
        重新同步监控
      </Button>
      <NodeMetricHistory id={id} active={active} currentCharts={metricCharts()} />
    </section>
  );
}
