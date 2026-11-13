import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getOverview,
  getOverviewTraffic,
  type Overview,
  type OverviewTraffic,
  type TrafficRange,
} from '@/api/overview';
import { useRealtimeConnection, useServerEvent } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function useOverview(range: TrafficRange) {
  const [overview, setOverview] = useState<Overview>();
  const [trafficByRange, setTraffic] = useState<Partial<Record<TrafficRange, OverviewTraffic>>>({});
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [trafficRevision, setTrafficRevision] = useState(0);
  const [, report] = useToastFeedback('error', 'overview-load');
  const [, reportTraffic] = useToastFeedback('error', 'overview-load');
  const [trafficLoading, setTrafficLoading] = useState(false);
  const connection = useRealtimeConnection();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(() => {
    setRevision((n) => n + 1);
    setTrafficRevision((n) => n + 1);
  }, []);
  useEffect(() => {
    void revision;
    void connection.generation;
    const controller = new AbortController();
    setLoading(true);
    report('');
    getOverview(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setOverview(value);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          report(cause instanceof Error ? cause.message : '无法读取总览，请刷新重试');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision, connection.generation, report]);
  useEffect(() => {
    void trafficRevision;
    void connection.generation;
    const controller = new AbortController();
    setTrafficLoading(true);
    reportTraffic('');
    getOverviewTraffic(range, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setTraffic((previous) => ({ ...previous, [range]: value }));
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          reportTraffic(cause instanceof Error ? cause.message : '无法读取流量，请刷新重试');
      })
      .finally(() => {
        if (!controller.signal.aborted) setTrafficLoading(false);
      });
    return () => controller.abort();
  }, [range, trafficRevision, connection.generation, reportTraffic]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useServerEvent(
    (event) => {
      if (event.type !== 'change' || timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        refresh();
      }, 500);
    },
    [
      { kind: 'nodes', all: true },
      { kind: 'node', all: true },
      { kind: 'tasks', all: true },
      { kind: 'engines', all: true },
      { kind: 'history', all: true },
    ],
  );
  return { overview, traffic: trafficByRange[range], loading: loading || trafficLoading, refresh };
}
