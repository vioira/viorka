import { useEffect, useState } from 'react';
import { mergeTCPHistory, type TCPHistory, type TCPRange } from '@/api/tcp-probe-history';
import type { TCPProbeBatch } from '@/api/telemetry';
import { useBrowserSocket } from '@/hooks/realtime';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

export function useTCPProbeHistory(id: string, active: boolean, probes: TCPProbeBatch | undefined) {
  const [range, setRange] = useState<TCPRange>('1h');
  const [result, setResult] = useState<{ range: TCPRange; data: TCPHistory }>();
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState<TCPProbeBatch[]>([]);
  const socket = useBrowserSocket();
  const [, report] = useToastFeedback('error');
  useEffect(() => {
    void version;
    if (!active) return;
    let generation = 0;
    let current: TCPHistory | undefined;
    let timeout: ReturnType<typeof setTimeout>;
    const waiting = () => {
      clearTimeout(timeout);
      setLoading(true);
      timeout = setTimeout(() => {
        setLoading(false);
        report('TCP 历史读取超时，请刷新历史。');
      }, 12000);
    };
    const unsubscribe = socket.subscribe((frame) => {
      if (frame.event === 'ready') {
        current = undefined;
        waiting();
        return;
      }
      if (frame.generation !== generation) return;
      if (frame.event === 'tcp_history_error') {
        clearTimeout(timeout);
        setLoading(false);
        current = undefined;
        const data = frame.data as { message?: string } | undefined;
        report(data?.message || 'TCP 历史读取失败，请刷新重试。');
      } else if (frame.event === 'tcp_history') {
        clearTimeout(timeout);
        setLoading(false);
        try {
          current = mergeTCPHistory(current, frame.data, id, range);
          setResult({ range, data: current });
          report('');
        } catch (error) {
          current = undefined;
          report(error instanceof Error ? error.message : 'TCP 历史增量无效，请刷新历史。');
        }
      }
    });
    waiting();
    generation = socket.setTCPHistory(id, range);
    return () => {
      clearTimeout(timeout);
      unsubscribe();
      socket.clearTCPHistory(generation);
    };
  }, [id, active, range, version, socket, report]);
  useEffect(() => {
    if (!probes) return;
    setLive((old) => {
      if (old.at(-1)?.sampled_at === probes.sampled_at) return old;
      const cutoff = Date.parse(probes.sampled_at) - 600000;
      const rows = new Map<string, TCPProbeBatch>();
      for (const point of [...old, probes]) {
        if (Date.parse(point.sampled_at) < cutoff) continue;
        const key = `${Math.floor(Date.parse(point.sampled_at) / 60000)}`;
        const previous = rows.get(key);
        if (!previous || Date.parse(previous.sampled_at) < Date.parse(point.sampled_at))
          rows.set(key, point);
      }
      return [...rows.values()]
        .sort((a, b) => Date.parse(a.sampled_at) - Date.parse(b.sampled_at))
        .slice(-256);
    });
  }, [probes]);
  return { range, setRange, result, live, loading, refresh: () => setVersion((v) => v + 1) };
}
