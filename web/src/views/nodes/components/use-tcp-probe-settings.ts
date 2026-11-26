import { useCallback, useEffect, useState } from 'react';
import type { TelemetrySettings } from '@/api/telemetry';
import { getTelemetrySettings } from '@/api/telemetry-settings';
import { useRealtimeConnection, useServerEvent } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function useTCPProbeSettings(id: string, active: boolean) {
  const [settings, setSettings] = useState<TelemetrySettings>();
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((previous) => previous + 1);
  const { generation } = useRealtimeConnection();
  const [error, report] = useToastFeedback('error', `tcp-probe-settings-${id}`);
  const accept = useCallback((next: TelemetrySettings) => {
    setSettings((current) => (current && current.revision > next.revision ? current : next));
  }, []);

  useServerEvent(
    (event) => {
      if (!active || event.type !== 'change') return;
      const change = event.change;
      if (change.node_id !== id || change.kind !== 'telemetry_settings') return;
      if (change.telemetry_settings) {
        accept(change.telemetry_settings.desired);
        report('');
      } else reload();
    },
    active ? [{ kind: 'telemetry_settings', node_id: id }] : [],
  );

  useEffect(() => {
    void version;
    void generation;
    if (!active) return;
    const controller = new AbortController();
    getTelemetrySettings(id, controller.signal)
      .then(({ desired }) => {
        if (controller.signal.aborted) return;
        accept(desired);
        report('');
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          report(cause instanceof Error ? cause.message : '读取 TCP 探测目标失败，请重试。');
      });
    return () => controller.abort();
  }, [id, active, generation, version, accept, report]);

  return { settings, error, reload };
}
