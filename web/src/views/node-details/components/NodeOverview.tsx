import { type NodeRecord, nodeKind, nodeTime } from '@/api/nodes';
import {
  decimalBytes,
  decimalPercent,
  filesystemUsagePercent,
  telemetryStale,
} from '@/api/telemetry';
import { MetricCard } from '@/components/arc/metric-card/metric-card';

export default function NodeOverview({ node, now }: { node: NodeRecord | null; now: number }) {
  const telemetry = node?.monitoring?.telemetry;
  const control = node?.monitoring?.telemetry_control;
  const fast =
    telemetry && !telemetryStale(telemetry, 'fast', now, control) ? telemetry.fast : undefined;
  const full =
    telemetry && !telemetryStale(telemetry, 'full', now, control) ? telemetry.full : undefined;
  const resources = [
    { label: 'CPU 使用率', value: fast?.cpu_percent, context: '最近有效采样' },
    {
      label: '内存使用率',
      value: decimalPercent(fast?.ram_used, fast?.ram_total) ?? undefined,
      context: `${decimalBytes(fast?.ram_used)} / ${decimalBytes(fast?.ram_total)}`,
    },
    {
      label: '本地文件系统使用率',
      value: filesystemUsagePercent(full?.disk_used, full?.disk_available) ?? undefined,
      context: `${decimalBytes(full?.disk_used)} / ${decimalBytes(full?.disk_total)}`,
    },
  ];
  const fields = [
    ['节点 ID', node?.id ?? '尚未读取'],
    ['节点类型', node ? nodeKind(node.kind) : '未知'],
    ['系统', node?.inventory?.os_name || node?.os || '尚未上报'],
    ['架构', node?.arch || '尚未上报'],
    ['Agent 版本', node?.agent_version || '尚未上报'],
    ['最后在线', nodeTime(node?.last_seen_at ?? '')],
    ['资产采集时间', nodeTime(node?.inventory?.sampled_at ?? '')],
  ];
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {resources.map(({ label, value, context }) =>
            value === undefined ? (
              <section
                key={label}
                aria-label={label}
                className="min-h-36 space-y-3 rounded-(--radius-panel) border-[0.5px] border-border bg-surface p-4"
              >
                <h2 className="text-text-secondary">{label}</h2>
                <p className="text-(length:--text-xl)">未知</p>
                <p className="text-(length:--text-xs) text-text-secondary">等待有效采样</p>
              </section>
            ) : (
              <MetricCard
                key={label}
                label={label}
                value={value}
                decimals={1}
                suffix="%"
                context={context}
              />
            ),
          )}
        </div>
      </div>
      <div className="min-w-0 space-y-6">
        <section
          className="rounded-(--radius-panel) border-[0.5px] border-border bg-surface p-4 sm:p-6"
          aria-label="节点信息"
        >
          <h2 className="font-medium">节点信息</h2>
          <dl className="mt-4 divide-y-[0.5px] divide-border">
            {fields.map(([label, value]) => (
              <div
                key={label}
                className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0"
              >
                <dt className="text-text-secondary">{label}</dt>
                <dd className="wrap-anywhere tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section
          className="rounded-(--radius-panel) border-[0.5px] border-border bg-surface p-4 sm:p-6"
          aria-label="网络地址"
        >
          <h2 className="font-medium">网络地址</h2>
          <dl className="mt-4 space-y-4">
            {[
              ['公网 IPv4（出口）', node?.inventory?.public_ipv4],
              ['公网 IPv6（出口）', node?.inventory?.public_ipv6],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-text-secondary">{label}</dt>
                <dd className="mt-1 wrap-anywhere tabular-nums">{value || '未知'}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-(length:--text-xs) text-text-secondary">
            出口地址不代表入站可达。服务商 NAT 映射与监听端口尚未接入。
          </p>
        </section>
        <p className="text-(length:--text-xs) text-text-secondary">
          引擎、代理服务与配置修订尚未接入；累计网卡计数不作为今日流量。
        </p>
      </div>
    </div>
  );
}
