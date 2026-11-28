import { ArrowRight, Globe, Server, Waypoints } from 'lucide-react';
import { Link } from 'react-router';
import type { Endpoint } from '@/api/relays';
import { Badge } from '@/components/arc/badge/badge';
import { endpointText, nodeEnginePath, proxyServicePath } from './relay-meta';

export interface RelayChainProps {
  entryName: string;
  entryNodeId?: string;
  entryOnline?: boolean;
  publicEndpoint: Endpoint;
  listenEndpoint: Endpoint;
  dialEndpoint?: Endpoint | null;
  landingName?: string;
  landingListen?: Endpoint | null;
  landingEngineId?: string;
  landingServiceId?: string;
  landingRevision?: number;
  cleanupOnly?: boolean;
  compact?: boolean;
}

export default function RelayChainStrip({
  entryName,
  entryNodeId,
  entryOnline,
  publicEndpoint,
  listenEndpoint,
  dialEndpoint,
  landingName,
  landingListen,
  landingEngineId,
  landingServiceId,
  landingRevision,
  cleanupOnly = false,
  compact = false,
}: RelayChainProps) {
  const natMapped =
    publicEndpoint.port > 0 &&
    listenEndpoint.port > 0 &&
    publicEndpoint.port !== listenEndpoint.port;
  const landingLink =
    !cleanupOnly && landingEngineId && landingServiceId
      ? proxyServicePath(landingEngineId, landingServiceId)
      : undefined;
  const entryLink = entryNodeId ? nodeEnginePath(entryNodeId, 'realm') : undefined;

  return (
    <div
      className={`grid min-w-0 items-stretch gap-2 rounded-(--radius-control) border-[1px] border-border bg-background ${
        compact
          ? 'p-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]'
          : 'p-3.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]'
      }`}
    >
      {/* Hop 1: Client Public Entry */}
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5 text-(length:--text-xs) text-text-secondary">
          <Globe size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          <span>客户端公网入口</span>
          {natMapped && (
            <Badge size="sm" tone="info">
              NAT
            </Badge>
          )}
        </div>
        <p className="font-mono text-(length:--text-xs) font-medium tabular-nums text-foreground wrap-anywhere">
          {endpointText(publicEndpoint)}
        </p>
        {!compact && natMapped && (
          <p className="text-(length:--text-xs) text-text-secondary tabular-nums">
            映射至本机 :{listenEndpoint.port}
          </p>
        )}
      </div>

      <div
        className="hidden items-center justify-center text-text-muted sm:flex"
        aria-hidden="true"
      >
        <ArrowRight size={15} strokeWidth={1.75} />
      </div>

      {/* Hop 2: Entry Realm */}
      <div className="min-w-0 space-y-1 border-t-[1px] border-border-subtle pt-2 sm:border-t-0 sm:pt-0">
        <div className="flex flex-wrap items-center gap-1.5 text-(length:--text-xs) text-text-secondary">
          <Waypoints size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          <span>入口 Realm</span>
          {entryOnline !== undefined && (
            <span
              className={`inline-flex items-center gap-1 text-(length:--text-xs) ${
                entryOnline ? 'text-success' : 'text-danger'
              }`}
            >
              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              {entryOnline ? '在线' : '离线'}
            </span>
          )}
        </div>
        {entryLink ? (
          <Link
            to={entryLink}
            className="block truncate text-(length:--text-xs) font-medium text-accent hover:underline"
          >
            {entryName || '未选择入口'}
          </Link>
        ) : (
          <p className="truncate text-(length:--text-xs) font-medium text-foreground">
            {entryName || '未选择入口'}
          </p>
        )}
        <p className="font-mono text-(length:--text-xs) text-text-secondary tabular-nums wrap-anywhere">
          监听 {endpointText(listenEndpoint)}
        </p>
      </div>

      <div
        className="hidden items-center justify-center text-text-muted sm:flex"
        aria-hidden="true"
      >
        <ArrowRight size={15} strokeWidth={1.75} />
      </div>

      {/* Hop 3: Landing Proxy Service */}
      <div className="min-w-0 space-y-1 border-t-[1px] border-border-subtle pt-2 sm:border-t-0 sm:pt-0">
        <div className="flex flex-wrap items-center gap-1.5 text-(length:--text-xs) text-text-secondary">
          <Server size={14} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          <span>落地代理服务</span>
          {!cleanupOnly && landingRevision ? (
            <span className="font-mono tabular-nums text-text-muted">r{landingRevision}</span>
          ) : null}
        </div>
        {cleanupOnly ? (
          <p className="text-(length:--text-xs) font-medium text-danger">导出权限已撤销</p>
        ) : landingLink ? (
          <Link
            to={landingLink}
            className="block truncate text-(length:--text-xs) font-medium text-accent hover:underline"
          >
            {landingName || '未选择落地'}
          </Link>
        ) : (
          <p className="truncate text-(length:--text-xs) font-medium text-foreground">
            {landingName || '未选择落地'}
          </p>
        )}
        {!cleanupOnly && dialEndpoint && (
          <p className="font-mono text-(length:--text-xs) text-text-secondary tabular-nums wrap-anywhere">
            拨号 {endpointText(dialEndpoint)}
          </p>
        )}
        {!compact && !cleanupOnly && landingListen && landingListen.port > 0 && (
          <p className="font-mono text-(length:--text-xs) text-text-muted tabular-nums wrap-anywhere">
            落地监听 {endpointText(landingListen)}
          </p>
        )}
      </div>
    </div>
  );
}
