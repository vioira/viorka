import type { ReactNode } from 'react';
import type { AlertSettings } from '@/api/alerts';
import { Button } from '@/components/arc/button/button';
import { channelSummary } from './delivery';

function SummaryCard({
  label,
  value,
  context,
  action,
}: {
  label: string;
  value: ReactNode;
  context?: string;
  action?: ReactNode;
}) {
  return (
    <article className="flex min-w-0 flex-col gap-2 rounded-(--radius-panel) border border-border bg-surface p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-2 sm:min-h-8">
        <h2 className="text-(length:--text-sm) font-medium text-text-secondary">{label}</h2>
        {action}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <strong className="min-w-0 [overflow-wrap:anywhere] text-(length:--text-xl) font-medium leading-tight text-foreground tabular-nums">
          {value}
        </strong>
        {context && (
          <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
            {context}
          </span>
        )}
      </div>
    </article>
  );
}

export default function NotificationOverview({
  data,
  disabled,
  editZone,
}: {
  data: AlertSettings | null;
  disabled: boolean;
  editZone: () => void;
}) {
  const config = data?.config;
  const enabled = config?.rules.filter((r) => r.enabled);
  const channels = data ? channelSummary(data) : null;
  return (
    <section aria-label="通知概览" className="grid gap-3 min-[380px]:grid-cols-2 lg:grid-cols-4">
      <SummaryCard
        label="生效规则"
        value={enabled?.length ?? '—'}
        context={config && `总计 ${config.rules.length} 条`}
      />
      <SummaryCard
        label="推送渠道状态"
        value={channels ?? '—'}
        context={config && `${config.channels.length} 个外部渠道`}
      />
      <SummaryCard label="站内通知" value="始终启用" context="系统内置" />
      <SummaryCard
        label="通知时区"
        value={
          <span className="text-(length:--text-base) sm:text-(length:--text-xl)">
            {config?.timezone.replaceAll('/', '/\u200b') ?? '—'}
          </span>
        }
        action={
          <Button variant="ghost" size="sm" disabled={disabled} onClick={editZone}>
            修改时区
          </Button>
        }
      />
    </section>
  );
}
