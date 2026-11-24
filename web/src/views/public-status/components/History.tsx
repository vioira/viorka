import { useEffect, useState } from 'react';
import { ApiError } from '@/api/client';
import { readHistory, type StatusHistory } from '@/api/public-status';
import { Button } from '@/components/arc/button/button';
import { LineChart } from '@/components/arc/line-chart/line-chart';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { useToastFeedback } from '@/hooks/use-toast-feedback';
import { cardClass, stamp } from '../format';

const charts = [
  ['cpu', 'CPU', '%', 'cpu'],
  ['memory', '内存', '%', 'memory'],
  ['disk', '磁盘', '%', 'disk'],
  ['load', '负载', '', 'load_one', 'load_five', 'load_fifteen'],
  ['network', '带宽', 'B/s', 'rx', 'tx'],
];
const labels: Record<string, string> = {
  load_one: '1 分钟',
  load_five: '5 分钟',
  load_fifteen: '15 分钟',
  rx: '下行',
  tx: '上行',
};
export default function History({ id }: { id: string }) {
  const [range, setRange] = useState('1h'),
    [retry, setRetry] = useState(0),
    [result, setResult] = useState<{ range: string; v: StatusHistory } | null>(null);
  const [, error] = useToastFeedback('error', 'status-history');
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter restarts the request and cancels its predecessor.
  useEffect(() => {
    const c = new AbortController();
    readHistory(id, range, c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          setResult({ range, v });
          error('');
        }
      })
      .catch((e) => {
        if (c.signal.aborted) return;
        if (e instanceof ApiError && e.status === 404) setResult(null);
        error(e.message);
      });
    return () => c.abort();
  }, [id, range, retry, error]);
  const v = result?.range === range ? result.v : null;
  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">历史趋势</h2>
        <SegmentedControl
          label="历史范围"
          value={range}
          onValueChange={setRange}
          options={['1h', '6h', '24h', '7d'].map((value, i) => ({
            value,
            label: ['1 小时', '6 小时', '24 小时', '7 天'][i],
          }))}
        />
        <Button variant="secondary" onClick={() => setRetry((v) => v + 1)}>
          刷新历史
        </Button>
      </div>
      {v ? (
        <>
          <div className="text-(length:--text-xs) text-text-secondary">
            {stamp(v.start)} 至 {stamp(v.end)}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {charts.map(([key, title, unit, ...keys]) => (
              <div key={key} className={cardClass}>
                <h3>{title}</h3>
                <LineChart
                  label={title}
                  unit={unit}
                  series={keys.map((k) => ({ key: k, label: labels[k] ?? title, area: false }))}
                  data={(v.charts[key]?.points ?? []).map((p) => ({
                    key: p.at,
                    label: stamp(p.at),
                    values: p.values,
                  }))}
                  emptyLabel="没有可用样本"
                />
              </div>
            ))}
            {v.lines.map((l) => {
              const period = v.probe_period * 1000;
              const end = Math.floor(Date.parse(v.end) / period) * period;
              const points = new Map(
                l.history.map((p) => [Math.floor(Date.parse(p.at) / period) * period, p]),
              );
              const start = Math.floor(Date.parse(v.start) / period) * period;
              const data = Array.from(
                { length: Math.floor((end - start) / period) + 1 },
                (_, index) => {
                  const t = start + index * period;
                  const p = points.get(t);
                  const at = new Date(t).toISOString();
                  return {
                    key: at,
                    label: stamp(p?.at ?? at),
                    values: { ping: p && p.ping >= 0 ? p.ping : null, loss: p?.loss ?? null },
                  };
                },
              );
              return (
                <div key={l.slot} className={cardClass}>
                  <h3>{l.name}</h3>
                  {(['ping', 'loss'] as const).map((k) => (
                    <LineChart
                      key={k}
                      label={k === 'ping' ? '连接延迟' : '连接失败率'}
                      unit={k === 'ping' ? 'ms' : '%'}
                      series={[{ key: k, label: k === 'ping' ? '延迟' : '失败率', area: false }]}
                      data={data}
                      height={144}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p>历史数据尚未读取。</p>
      )}
    </section>
  );
}
