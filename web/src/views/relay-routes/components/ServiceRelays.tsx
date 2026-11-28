import { ArrowRight, ArrowUpRight, Plus, RefreshCw, Send } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { type RelayRoute, relayTargetsPreviousLanding } from '@/api/relays';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import {
  createRelayForLandingPath,
  endpointText,
  isNatMapped,
  needsRelayPublication,
  relayRoutePath,
  relayStatusLabel,
  relayTone,
} from '@/components/proxy/relay-meta';
import { useRelays } from './use-relays';

export default function ServiceRelays({
  engine,
  service,
  published,
  canManage,
  initialRoutes,
  onAddRelay,
  onPublishRelay,
}: {
  engine: string;
  service: string;
  published: boolean;
  canManage: boolean;
  initialRoutes?: RelayRoute[];
  onAddRelay?: () => void;
  onPublishRelay?: (route: RelayRoute) => void;
}) {
  const { data, busy, reload } = useRelays(engine, service, initialRoutes === undefined);
  const navigate = useNavigate();
  const routes = initialRoutes ?? data?.items ?? null;

  return (
    <section className="space-y-2.5" aria-label="关联中转线路">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-(length:--text-xs) font-medium text-text-secondary">关联中转线路</h3>
          {routes && (
            <Badge size="sm" tone="neutral">
              {routes.length} 条
            </Badge>
          )}
        </div>
        {canManage && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!published}
            onClick={() => {
              if (onAddRelay) onAddRelay();
              else void navigate(createRelayForLandingPath(engine, service));
            }}
          >
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
            添加中转
          </Button>
        )}
      </div>

      {routes && routes.length > 0 ? (
        <ul className="divide-y-[1px] divide-border-subtle rounded-(--radius-control) border-[1px] border-border bg-background">
          {routes.map((r) => {
            const pendingLanding = r.reason === 'available' && relayTargetsPreviousLanding(r);
            const path = pendingLanding ? r.draft : (r.serving_path ?? r.published ?? r.draft);
            const nat = isNatMapped(path);
            const showPublish = Boolean(
              canManage &&
                r.can_manage &&
                !r.cleanup_only &&
                needsRelayPublication(r) &&
                r.publish_base &&
                onPublishRelay,
            );
            return (
              <li key={r.id} className="space-y-2 px-3.5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    to={relayRoutePath(r.id)}
                    className="inline-flex min-w-0 items-center gap-1 text-(length:--text-sm) font-medium text-foreground hover:text-accent hover:underline wrap-anywhere"
                  >
                    <span className="truncate">{r.draft.name}</span>
                    <ArrowUpRight
                      size={14}
                      strokeWidth={1.75}
                      className="shrink-0"
                      aria-hidden="true"
                    />
                  </Link>
                  <Badge size="sm" dot tone={pendingLanding ? 'warning' : relayTone(r)}>
                    {pendingLanding ? '落地切换待发布' : relayStatusLabel(r)}
                  </Badge>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-(length:--text-xs) text-text-secondary">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 tabular-nums">
                    <span className="font-medium text-foreground">{r.entry_name}</span>
                    <ArrowRight
                      size={12}
                      strokeWidth={1.75}
                      className="shrink-0 text-text-muted"
                      aria-hidden="true"
                    />
                    <span className="font-mono wrap-anywhere">{endpointText(path.public)}</span>
                    {nat && (
                      <Badge size="sm" tone="info">
                        NAT
                      </Badge>
                    )}
                  </div>
                  {showPublish && onPublishRelay && (
                    <Button size="sm" variant="secondary" onClick={() => onPublishRelay(r)}>
                      <Send size={13} strokeWidth={1.75} aria-hidden="true" />
                      发布
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-control) border-[1px] border-border bg-background px-3.5 py-3 text-(length:--text-xs) text-text-secondary">
          <span>
            {routes
              ? !published
                ? '需先发布并运行服务，且登记公网入口后方可添加中转。'
                : '当前仅通过节点直连提供访问，尚未绑定中转线路。'
              : busy
                ? '正在读取关联中转线路…'
                : '关联中转线路尚未读取'}
          </span>
          {!busy && !routes && (
            <Button variant="secondary" size="sm" onClick={() => void reload()}>
              <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
              重试
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
