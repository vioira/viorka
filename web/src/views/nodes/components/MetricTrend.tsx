import { useEffect, useRef, useState } from 'react';
import { historyRuns, type MetricHistory } from '@/api/metric-history';
import { bytes } from '@/api/monitoring';
export default function MetricTrend({
  metric: key,
  label,
  unit,
  data,
  start,
  end,
}: {
  metric: string;
  label: string;
  unit: string;
  data?: MetricHistory;
  start: number;
  end: number;
}) {
  const figure = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const node = figure.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const runs = historyRuns(data?.points ?? [], key, data?.period_seconds ?? 60);
  const values = runs.flat();
  const max = unit === '%' ? 100 : Math.max(1, ...values.map((p) => p.stats[key].max));
  const x = (at: string) =>
    72 + Math.max(0, Math.min(1, (Date.parse(at) - start) / (end - start))) * (width - 88);
  const y = (v: number) => 140 - (v / max) * 120;
  const format = (v: number) => (unit === 'B/s' ? `${bytes(v)}/s` : `${v.toFixed(1)}${unit}`);
  return (
    <figure ref={figure} aria-label={`${label}历史趋势`} className="min-w-0">
      <figcaption className="mb-2 font-medium">{label}</figcaption>
      {/* Arc LineChart coerces missing values to zero. This static semantic SVG
              renders separate paths for gaps without changing Arc's implementation. */}
      <svg
        viewBox={`0 0 ${width} 192`}
        role="img"
        aria-label={
          values.length
            ? `${label}，${values.length} 个有效时间桶，峰值 ${format(Math.max(...values.map((p) => p.stats[key].max)))}`
            : `${label}，${data ? '暂无有效历史采样' : '尚未读取'}`
        }
        className="h-48 w-full text-text-secondary"
      >
        {[0, 0.5, 1].map((r) => (
          <g key={r}>
            <line
              x1="72"
              x2={width - 16}
              y1={y(r * max)}
              y2={y(r * max)}
              stroke="var(--border)"
              strokeWidth="0.5"
            />
            <text x="68" y={y(r * max) + 4} textAnchor="end" fill="currentColor" fontSize="12">
              {unit === 'B/s' ? bytes(r * max) : (r * max).toFixed(1)}
            </text>
          </g>
        ))}
        {runs.map((run) => (
          <g key={run[0].at}>
            {(['avg', 'max'] as const).map((stat) => (
              <path
                key={stat}
                d={run
                  .map(
                    (p, i) =>
                      `${i ? 'L' : 'M'}${x(p.at)},${y(stat === 'avg' ? p.stats[key].sum / p.stats[key].count : p.stats[key].max)}`,
                  )
                  .join(' ')}
                fill="none"
                stroke={stat === 'avg' ? 'var(--foreground)' : 'var(--text-secondary)'}
                strokeWidth="1.5"
                strokeDasharray={stat === 'max' ? '4 3' : undefined}
              />
            ))}
            {run.length === 1 && (
              <circle
                cx={x(run[0].at)}
                cy={y(run[0].stats[key].sum / run[0].stats[key].count)}
                r="2"
                fill="var(--foreground)"
              />
            )}
          </g>
        ))}
        {!values.length && (
          <text x={width / 2} y="80" textAnchor="middle" fill="currentColor" fontSize="14">
            {data ? '暂无有效历史采样' : '尚未读取'}
          </text>
        )}
        {data && (
          <>
            <text x="72" y="184" fill="currentColor" fontSize="12">
              {new Date(start).toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </text>
            <text x={width - 16} y="184" textAnchor="end" fill="currentColor" fontSize="12">
              {new Date(end).toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </text>
          </>
        )}
      </svg>
    </figure>
  );
}
