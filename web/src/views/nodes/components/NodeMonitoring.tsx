import { useEffect, useMemo, useState } from 'react';
import type { MonitoringSnapshot } from '@/api/monitoring';
import { telemetryStale } from '@/api/telemetry';
import { Button } from '@/components/arc/button/button';
import { metricCharts } from './metric-chart';
import NodeMetricHistory from './NodeMetricHistory';
import TCPProbeQuality from './TCPProbeQuality';
import TelemetryMonitoring from './TelemetryMonitoring';
import { telemetryChartPoints, telemetryCharts } from './telemetry-chart';

export default function NodeMonitoring({
  id,
  active,
  connectionState,
  onHistoryModeChange,
  snapshot,
  onRefresh,
}: {
  id: string;
  active: boolean;
  connectionState?: string;
  onHistoryModeChange?: (history: boolean) => void;
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
  const telemetry = snapshot?.telemetry;
  const control = snapshot?.telemetry_control;
  const charts = useMemo(
    () => (telemetry ? telemetryCharts(telemetry, now, control) : metricCharts()),
    [telemetry, now, control],
  );
  const points = useMemo(
    () => (telemetry ? telemetryChartPoints(telemetry) : undefined),
    [telemetry],
  );
  return (
    <section aria-label="主机监控" className="space-y-4">
      {!telemetry && (
        <div className="space-y-4 pt-6">
          <p className="text-text-secondary">
            {snapshot ? '尚未收到监控，请连接支持 telemetry v3 的 Agent。' : '正在读取监控…'}
          </p>
          <Button variant="ghost" onClick={onRefresh}>
            重新同步监控
          </Button>
        </div>
      )}
      <NodeMetricHistory
        id={id}
        active={active}
        connectionState={connectionState}
        onHistoryModeChange={onHistoryModeChange}
        points={points}
        currentCharts={charts}
      />
      <TCPProbeQuality
        key={`tcp-${id}`}
        id={id}
        active={active}
        telemetry={telemetry}
        stale={!telemetry || telemetryStale(telemetry, 'full', now, control)}
        now={now}
      />
      {telemetry && snapshot && (
        <TelemetryMonitoring key={id} snapshot={snapshot} telemetry={telemetry} now={now} />
      )}
    </section>
  );
}
