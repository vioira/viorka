import { useEffect, useState } from 'react';
import {
  bytes,
  getMonitoring,
  isStale,
  type MonitoringSnapshot,
  percent,
  recentSeries,
} from '@/api/monitoring';
import { nodeTime } from '@/api/nodes';
import { Button } from '@/components/arc/button/button';
import { LineChart } from '@/components/arc/line-chart/line-chart';
import { useToastFeedback } from '@/hooks/use-toast-feedback';

const errors: Record<string, string> = {
  cpu_unavailable: 'CPU',
  memory_unavailable: '内存',
  load_unavailable: '负载',
  disk_unavailable: '磁盘',
  uptime_unavailable: '运行时长',
  network_unavailable: '网络',
  unsupported_platform: '当前系统不支持主机采集',
};
export default function NodeMonitoring({ id, active }: { id: string; active: boolean }) {
  const [snapshot, setSnapshot] = useState<MonitoringSnapshot>();
  const [now, setNow] = useState(0);
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  const [, report] = useToastFeedback('error');
  useEffect(() => {
    void retry; // Explicit refresh starts a new bounded polling cycle.
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const load = async () => {
      try {
        const v = await getMonitoring(id, controller.signal);
        if (!stopped) {
          setSnapshot(v);
          report('');
        }
      } catch (e) {
        if (!stopped) report(e instanceof Error ? e.message : '无法读取监控，请刷新重试。');
      } finally {
        if (!stopped) {
          setLoading(false);
          timer = setTimeout(load, 15000);
        }
      }
    };
    setLoading(true);
    void load();
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [id, active, retry, report]);
  const stale = isStale(snapshot, now);
  const m = snapshot?.latest;
  const live = stale ? undefined : m;
  const fields = [
    [
      'CPU 使用率',
      live?.cpu?.usage_percent === undefined
        ? '未知，等待有效采样'
        : `${live.cpu.usage_percent.toFixed(1)}%`,
    ],
    ['逻辑 CPU', live?.cpu ? `${live.cpu.logical_cpus}` : '未知'],
    ['内存已用 / 总量', `${bytes(live?.memory?.used_bytes)} / ${bytes(live?.memory?.total_bytes)}`],
    [
      '内存使用率',
      percent(live?.memory?.used_bytes, live?.memory?.total_bytes) === null
        ? '未知'
        : `${percent(live?.memory?.used_bytes, live?.memory?.total_bytes)}%`,
    ],
    [
      'Swap 已用 / 总量',
      `${bytes(live?.memory?.swap_used_bytes)} / ${bytes(live?.memory?.swap_total_bytes)}`,
    ],
    [
      '根文件系统已用 / 总量',
      `${bytes(live?.disk?.used_bytes)} / ${bytes(live?.disk?.total_bytes)}`,
    ],
    ['根文件系统可用', bytes(live?.disk?.available_bytes)],
    [
      '负载 1 / 5 / 15 分钟',
      live?.load
        ? [live.load.one, live.load.five, live.load.fifteen].map((n) => n.toFixed(2)).join(' / ')
        : '未知',
    ],
    [
      '运行时长',
      live?.uptime_seconds === undefined
        ? '未知'
        : `${Math.floor(live.uptime_seconds / 86400)} 天 ${Math.floor((live.uptime_seconds % 86400) / 3600)} 小时`,
    ],
  ];
  return (
    <section
      aria-label="主机监控"
      aria-busy={loading}
      className="space-y-4 border-t-[0.5px] border-border pt-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h3 className="font-medium">主机监控</h3>
        <Button variant="ghost" className="min-h-11" onClick={() => setRetry((n) => n + 1)}>
          刷新监控
        </Button>
      </div>
      <p role="status" className="text-text-secondary">
        {loading && !snapshot
          ? '正在读取监控…'
          : !m
            ? '尚未收到监控，请确认 Agent 支持监控并已连接。'
            : stale
              ? '数据已过期或节点离线，当前指标未知。'
              : m.errors.length
                ? '部分指标不可用'
                : '正在接收监控'}
      </p>
      <p className="text-(length:--text-xs) text-text-secondary">
        最近采样：{m ? nodeTime(m.sampled_at) : '尚未上报'}
      </p>
      {!!m?.errors.length && (
        <p className="text-text-secondary">
          不可用项：{m.errors.map((e) => errors[e] ?? e).join('、')}
        </p>
      )}
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-text-secondary">{label}</dt>
            <dd className="mt-1 min-h-5 wrap-anywhere tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <h3 className="pt-2 font-medium">网卡流量</h3>
      <p className="text-(length:--text-xs) text-text-secondary">
        排除回环接口。累计值随网卡或系统重启重置，不代表今日用量或服务商计费；虚拟网卡可能重复计数。
      </p>
      {!live?.interfaces.length && (
        <p className="text-text-secondary">
          {stale ||
          m?.errors.includes('network_unavailable') ||
          m?.errors.includes('unsupported_platform')
            ? '网络指标未知'
            : '未发现非回环网卡'}
        </p>
      )}
      {live?.interfaces.map((i) => (
        <section
          key={i.name}
          aria-label={`网卡 ${i.name}`}
          className="space-y-2 border-t-[0.5px] border-border pt-4"
        >
          <h4 className="wrap-anywhere font-medium">{i.name}</h4>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[
              [
                '接收速率',
                i.rx_bytes_per_second === undefined
                  ? '等待有效采样'
                  : `${bytes(i.rx_bytes_per_second)}/s`,
              ],
              [
                '发送速率',
                i.tx_bytes_per_second === undefined
                  ? '等待有效采样'
                  : `${bytes(i.tx_bytes_per_second)}/s`,
              ],
              ['累计接收', bytes(i.rx_bytes)],
              ['累计发送', bytes(i.tx_bytes)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-text-secondary">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <h3 className="pt-2 font-medium">最近一小时</h3>
      <p className="text-(length:--text-xs) text-text-secondary">
        每分钟保留最后一次采样，Panel
        重启后重新积累。图表仅显示最近一段连续有效数据，缺失不计为零；网络趋势为全部非回环网卡合计。
      </p>
      {(['cpu', 'memory', 'rx', 'tx'] as const).map((key) => {
        const label = {
          cpu: 'CPU 使用率',
          memory: '内存使用率',
          rx: '接收速率合计',
          tx: '发送速率合计',
        }[key];
        const network = key === 'rx' || key === 'tx';
        const data = recentSeries(
          snapshot?.history ?? [],
          key,
          Math.max(90, (m?.interval_seconds ?? 0) * 1.5) * 1000,
        ).map((p) => ({
          key: p.at,
          label: nodeTime(p.at),
          axisLabel: new Date(p.at).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          values: { value: p[key] as number },
        }));
        return (
          <div key={key} className="min-w-0">
            <h4 className="mb-2 font-medium">{label}</h4>
            <LineChart
              label={label}
              data={data}
              series={[{ key: 'value', label, area: false }]}
              curve="linear"
              height={160}
              categoryLabel="采样时间"
              unit={network ? '' : '%'}
              formatValue={(n) => (network ? `${bytes(n)}/s` : n.toFixed(1))}
              formatTick={(n) => (network ? bytes(n) : n.toFixed(0))}
              emptyLabel="暂无连续有效采样"
              loading={loading}
            />
          </div>
        );
      })}
    </section>
  );
}
