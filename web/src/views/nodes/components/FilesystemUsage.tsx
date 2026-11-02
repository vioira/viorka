import { bytes, diskPercent, type FilesystemMetrics, filesystemTotal } from '@/api/monitoring';

export default function FilesystemUsage({ metrics }: { metrics?: FilesystemMetrics }) {
  const total = filesystemTotal(metrics);
  const mounts = metrics?.errors.length ? [] : (metrics?.mounts ?? []);
  return (
    <section className="min-w-0 space-y-4" aria-label="本地文件系统">
      <h3 className="font-medium">本地文件系统</h3>
      <p className="text-(length:--text-xs) text-text-secondary">
        排除内存和网络挂载，同一文件系统只计一次。可用容量不含保留空间，使用率按 df 口径计算。
      </p>
      <p className="wrap-anywhere tabular-nums">
        已用 / 总量：{bytes(total?.used_bytes)} / {bytes(total?.total_bytes)}，可用{' '}
        {bytes(total?.available_bytes)}
      </p>
      {!mounts.length && (
        <p className="text-text-secondary">
          {metrics?.errors.length
            ? '文件系统采集不可用'
            : metrics
              ? '未发现支持的本地文件系统'
              : '尚未上报文件系统列表'}
        </p>
      )}
      <dl className="divide-y-[0.5px] divide-border">
        {mounts.map((m) => (
          <div
            key={m.mount_point}
            className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
          >
            <dt className="wrap-anywhere">
              {m.mount_point} <span className="text-text-secondary">({m.filesystem_type})</span>
            </dt>
            <dd className="wrap-anywhere tabular-nums">
              已用 {bytes(m.usage.used_bytes)} / {bytes(m.usage.total_bytes)}，可用{' '}
              {bytes(m.usage.available_bytes)}，使用率{' '}
              {diskPercent(m.usage) === undefined ? '未知' : `${diskPercent(m.usage)}%`}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
