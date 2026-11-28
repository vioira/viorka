import { AlertCircle, ArrowUpRight, Link2, RefreshCw } from 'lucide-react';
import { Link } from 'react-router';
import { engineSyncError } from '@/api/engines';
import type { RelayRoute } from '@/api/relays';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent, useDrawerItem } from '@/components/arc/drawer/drawer';
import { StatusIndicator } from '@/components/node-status';
import ServiceRelays from '@/views/relay-routes/components/ServiceRelays';
import { endpoint, type ServiceRow } from '../service-data';

const serviceStatusColors: Record<string, string> = {
  运行中: 'text-success',
  已同步: 'text-success',
  异常: 'text-danger',
  应用失败: 'text-danger',
  草稿未发布: 'text-warning',
  未发布: 'text-warning',
  待同步: 'text-warning',
  待删除: 'text-warning',
  已停止: 'text-text-secondary',
  未知: 'text-text-secondary',
};

export function ServiceStatus({ value }: { value: string }) {
  return (
    <StatusIndicator text={value} className={serviceStatusColors[value] ?? 'text-text-secondary'} />
  );
}

export default function ServiceInspectorDrawer({
  service,
  relaysLoaded,
  canManage,
  revealing,
  retrying,
  onClose,
  onRevealConnections,
  onRetrySync,
  onManageNodeEngine,
  onAddRelay,
  onPublishRelay,
  returnFocus,
}: {
  service: ServiceRow | null;
  relaysLoaded: boolean;
  canManage: boolean;
  revealing: boolean;
  retrying: boolean;
  onClose: () => void;
  onRevealConnections: (row: ServiceRow) => void;
  onRetrySync: (row: ServiceRow) => void;
  onManageNodeEngine: (row: ServiceRow) => void;
  onAddRelay: (row: ServiceRow) => void;
  onPublishRelay: (route: RelayRoute) => void;
  returnFocus: () => void;
}) {
  const row = useDrawerItem(service);
  const canConnect = Boolean(
    row &&
      row.engine.name !== 'realm' &&
      row.node.state === 'online' &&
      row.runtime === '运行中' &&
      !row.service.pending_delete,
  );
  const canRetry = Boolean(
    row &&
      canManage &&
      row.node.state === 'online' &&
      row.engine.sync_state === 'failed' &&
      !['unknown', 'degraded'].includes(row.engine.status),
  );
  const syncErrorText = row?.engine.sync_error_message
    ? row.engine.sync_error_message
    : row?.engine.sync_error
      ? engineSyncError(row.engine.sync_error)
      : '';

  return (
    <Drawer
      open={service !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        title={row?.name ?? '服务详情'}
        description={
          row
            ? `${row.node.name}，${row.engine.name}${row.engine.version ? ` ${row.engine.version}` : ''}`
            : undefined
        }
        className="[--drawer-size:min(36rem,calc(100vw-var(--space-4)))]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        footer={
          row ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              {row.engine.name !== 'realm' && row.relays.length > 0 ? (
                <Link
                  to={`/proxy/relays?filterLanding=${encodeURIComponent(row.id)}`}
                  className="inline-flex items-center gap-1 text-(length:--text-xs) font-medium text-accent hover:underline"
                >
                  在中转线路中查看全部
                  <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
                </Link>
              ) : (
                <span />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" onClick={onClose}>
                  关闭
                </Button>
                <Button type="button" onClick={() => onManageNodeEngine(row)}>
                  前往节点引擎管理
                  <ArrowUpRight size={16} strokeWidth={1.75} aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        {row && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b-[1px] border-border-subtle pb-4">
              <div className="flex flex-wrap items-center gap-4">
                <ServiceStatus value={row.runtime} />
                <ServiceStatus value={row.configuration} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {canConnect && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    loading={revealing}
                    disabled={revealing}
                    onClick={() => onRevealConnections(row)}
                  >
                    <Link2 size={16} strokeWidth={1.75} aria-hidden="true" />
                    连接信息
                  </Button>
                )}
                {canRetry && (
                  <Button
                    type="button"
                    size="sm"
                    loading={retrying}
                    disabled={retrying}
                    onClick={() => onRetrySync(row)}
                  >
                    <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
                    重试同步
                  </Button>
                )}
              </div>
            </div>

            {row.engine.sync_state === 'failed' && syncErrorText && (
              <section
                aria-label="同步失败原因"
                className="space-y-1.5 rounded-(--radius-control) border-[1px] border-border bg-surface-muted p-3.5"
              >
                <div className="flex items-center gap-2 text-(length:--text-xs) font-medium text-danger">
                  <AlertCircle size={15} strokeWidth={1.75} aria-hidden="true" />
                  <span>同步失败</span>
                </div>
                <p className="text-(length:--text-xs) leading-relaxed text-text-secondary wrap-anywhere">
                  {syncErrorText}
                </p>
              </section>
            )}

            {row.engine.name !== 'realm' && (
              <ServiceRelays
                key={row.id}
                engine={row.engine.id}
                service={row.service.id}
                canManage={canManage}
                published={row.relayEligible}
                initialRoutes={relaysLoaded ? row.relays : undefined}
                onAddRelay={() => onAddRelay(row)}
                onPublishRelay={onPublishRelay}
              />
            )}

            <section aria-label="流量路径" className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
                  流量路径（草稿地址）
                </h3>
                {row.hasDraftChanges && (
                  <Badge tone="warning" size="sm">
                    发布后生效
                  </Badge>
                )}
              </div>
              <dl className="divide-y-[1px] divide-border-subtle rounded-(--radius-control) border-[1px] border-border bg-background">
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">公网入口</dt>
                  <dd className="font-mono text-(length:--text-xs) tabular-nums text-foreground wrap-anywhere text-right">
                    {row.endpoint}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">节点监听</dt>
                  <dd className="font-mono text-(length:--text-xs) tabular-nums text-foreground wrap-anywhere text-right">
                    {endpoint(row.service.listen_host, row.service.listen_port)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                    {row.engine.name === 'realm' ? '转发目标' : '握手目标'}
                  </dt>
                  <dd className="font-mono text-(length:--text-xs) tabular-nums text-foreground wrap-anywhere text-right">
                    {endpoint(row.service.target_host, row.service.target_port)}
                  </dd>
                </div>
              </dl>
            </section>

            <section aria-label="协议与参数继承" className="space-y-2.5">
              <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
                协议与参数继承
              </h3>
              <dl className="divide-y-[1px] divide-border-subtle rounded-(--radius-control) border-[1px] border-border bg-background">
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">协议类型</dt>
                  <dd className="text-(length:--text-xs) text-foreground text-right wrap-anywhere">
                    {row.protocol}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">协议预设</dt>
                  <dd className="text-(length:--text-xs) text-right wrap-anywhere">
                    {row.service.preset_id ? (
                      <Link
                        to={`/proxy/protocol-presets/${encodeURIComponent(row.service.preset_id)}/edit`}
                        className="font-medium text-accent hover:underline"
                      >
                        {row.presetName || row.service.preset_id}
                      </Link>
                    ) : (
                      <span className="text-text-secondary">未引用预设</span>
                    )}
                  </dd>
                </div>
                {row.service.preset_id && (
                  <>
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                        监听端口策略
                      </dt>
                      <dd className="text-(length:--text-xs) tabular-nums text-foreground text-right">
                        {row.service.port_override
                          ? `节点独立覆盖（${row.service.port_override}）`
                          : `继承预设默认值（${row.service.listen_port}）`}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                        SNI 策略
                      </dt>
                      <dd className="text-(length:--text-xs) text-foreground text-right wrap-anywhere">
                        {row.service.sni_override
                          ? `节点独立覆盖（${row.service.sni_override}）`
                          : '继承预设默认值'}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </section>

            <section aria-label="版本状态" className="space-y-2.5">
              <h3 className="text-(length:--text-xs) font-medium text-text-secondary">版本状态</h3>
              <dl className="grid grid-cols-3 divide-x-[1px] divide-border-subtle rounded-(--radius-control) border-[1px] border-border bg-background text-center">
                <div className="px-2 py-2.5">
                  <dt className="text-(length:--text-xs) text-text-secondary">草稿</dt>
                  <dd className="mt-0.5 text-(length:--text-sm) font-medium tabular-nums">
                    v{row.engine.draft.version}
                  </dd>
                </div>
                <div className="px-2 py-2.5">
                  <dt className="text-(length:--text-xs) text-text-secondary">期望目标</dt>
                  <dd className="mt-0.5 text-(length:--text-sm) font-medium tabular-nums">
                    r{row.engine.desired_revision}
                  </dd>
                </div>
                <div className="px-2 py-2.5">
                  <dt className="text-(length:--text-xs) text-text-secondary">Agent 实测</dt>
                  <dd className="mt-0.5 text-(length:--text-sm) font-medium tabular-nums">
                    r{row.engine.observed_revision}
                  </dd>
                </div>
              </dl>
              <p className="text-(length:--text-xs) leading-relaxed text-text-secondary">
                运行状态依据已发布配置与引擎上报，不含外部连通性验证。
              </p>
            </section>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
