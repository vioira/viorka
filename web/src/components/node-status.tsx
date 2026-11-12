import { Link } from 'react-router';
import { nodeTime } from '@/api/nodes';
import { Tooltip } from '@/components/arc/tooltip/tooltip';

const states: Record<string, { text: string; className: string }> = {
  pending: { text: '待注册', className: 'text-warning' },
  disabled: { text: '已禁用', className: 'text-text-secondary' },
  online: { text: '在线', className: 'text-success' },
  offline: { text: '离线', className: 'text-danger' },
  degraded: { text: '受限', className: 'text-warning' },
};
export default function NodeStatus({
  state,
  lastSeenAt = '',
}: {
  state: string;
  lastSeenAt?: string;
}) {
  const statusInfo = states[state] ?? { text: '未知', className: 'text-text-secondary' };
  const status = <StatusIndicator text={statusInfo.text} className={statusInfo.className} />;
  if (state !== 'offline') return status;
  const lastSeen = `最后在线：${nodeTime(lastSeenAt)}`;
  return (
    <div>
      <Tooltip content={<span className="tabular-nums">{lastSeen}</span>}>
        {/* Keyboard focus exposes supplemental status information without button styling. */}
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Tooltip content must also be reachable by keyboard. */}
        <span tabIndex={0} className="inline-flex cursor-help">
          {status}
        </span>
      </Tooltip>
      <span className="hidden text-(length:--text-xs) text-text-secondary tabular-nums [@media(hover:none)]:block">
        {lastSeen}
      </span>
    </div>
  );
}

export function StatusIndicator({ text, className }: { text: string; className: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {text}
    </span>
  );
}

export function NodeStatusLink({
  id,
  name,
  state,
  lastSeenAt = '',
}: {
  id: string;
  name: string;
  state: string;
  lastSeenAt?: string;
}) {
  const info = states[state] ?? { text: '未知', className: 'text-text-secondary' };
  const description =
    state === 'offline' ? `${info.text}，最后在线：${nodeTime(lastSeenAt)}` : info.text;
  return (
    <Tooltip content={<span className="tabular-nums">{description}</span>}>
      <Link
        to={`/nodes/${encodeURIComponent(id)}`}
        aria-label={`${name}，${description}`}
        className="inline-flex min-h-11 items-center gap-2 font-medium text-success hover:underline wrap-anywhere"
      >
        <span
          className={`size-1.5 shrink-0 rounded-full bg-current ${info.className}`}
          aria-hidden="true"
        />
        {name}
      </Link>
    </Tooltip>
  );
}
