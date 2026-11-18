import { useCallback, useEffect, useState } from 'react';
import type { Overview, OverviewTraffic, TrafficRange } from '@/api/overview';
import { useBrowserSocket } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function useOverview(range: TrafficRange) {
  const socket = useBrowserSocket();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [overview, setOverview] = useState<Overview>();
  const [trafficByRange, setTraffic] = useState<Partial<Record<TrafficRange, OverviewTraffic>>>({});
  const [loading, setLoading] = useState(true);
  const [trafficLoading, setTrafficLoading] = useState(true);
  const [, report] = useToastFeedback('error', 'overview-stats');
  const [, reportTraffic] = useToastFeedback('error', 'overview-traffic');
  useEffect(() => () => socket.clearOverview(), [socket]);
  useEffect(() => {
    const unsubscribe = socket.subscribe(({ event, data }) => {
      switch (event) {
        case 'overview':
          setOverview(data as Overview);
          setLoading(false);
          report('');
          break;
        case 'overview_traffic':
          setTraffic((previous) => ({ ...previous, [range]: data as OverviewTraffic }));
          setTrafficLoading(false);
          reportTraffic('');
          break;
        case 'overview_error':
          setLoading(false);
          report('无法读取总览统计，请刷新重试');
          break;
        case 'overview_traffic_error':
          setTrafficLoading(false);
          reportTraffic('无法读取流量趋势，请刷新重试');
          break;
        case 'disconnected':
        case 'closed':
          setLoading(false);
          setTrafficLoading(false);
          break;
      }
    });
    setTrafficLoading(true);
    socket.setOverview(range, timezone);
    return unsubscribe;
  }, [range, timezone, socket, report, reportTraffic]);
  const refresh = useCallback(() => {
    setLoading(true);
    setTrafficLoading(true);
    socket.setOverview(range, timezone, true);
  }, [socket, range, timezone]);
  return {
    overview,
    traffic: trafficByRange[range],
    loading: loading || trafficLoading,
    trafficLoading: trafficLoading && !trafficByRange[range],
    refresh,
  };
}
