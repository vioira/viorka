import { KeyRound, Pencil, Trash2, Undo2, Waypoints } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import type { EngineService } from '@/api/engines';
import type { RelayRoute } from '@/api/relays';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import DataTable, { type DataColumn } from '@/components/data-table';
import { relayRoutePath, summarizeServiceRelays } from '@/components/proxy/relay-meta';

const endpoint = (host: string, port: number) =>
  `${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;

export default function EngineServiceTable({
  services,
  managedRelay,
  relayOptions,
  realm,
  disabled,
  canReveal,
  onUpdate,
  onEdit,
  onReveal,
  onRotate,
  canRotate,
}: {
  managedRelay: (id: string) => boolean;
  relayOptions: (s: EngineService) => {
    enabled: boolean;
    relays: RelayRoute[];
    loaded: boolean;
    onAdd: (trigger: HTMLElement | null) => void;
    onInspect: (trigger: HTMLElement | null) => void;
  };
  services: EngineService[];
  realm: boolean;
  disabled: boolean;
  canReveal: boolean;
  onUpdate: (services: EngineService[]) => void;
  onEdit: (service: EngineService, trigger: HTMLElement | null) => void;
  onReveal: (id: string, trigger: HTMLButtonElement) => void;
  onRotate: (service: EngineService, trigger: HTMLElement | null) => void;
  canRotate: boolean;
}) {
  const actionId = useId();
  function patch(service: EngineService, changes: Partial<EngineService>) {
    onUpdate(services.map((item) => (item.id === service.id ? { ...item, ...changes } : item)));
  }

  const columns: DataColumn<EngineService>[] = [
    {
      key: 'name',
      label: realm ? '规则名称' : '服务名称',
      render: (_, service) => (
        <div className="min-w-0 space-y-1 wrap-anywhere">
          <p className="font-medium text-foreground">{service.name}</p>
          {!realm && (
            <div className="flex flex-wrap items-center gap-1.5 text-(length:--text-xs) text-text-secondary">
              <span>VLESS</span>
              {service.preset_id && (
                <Badge size="sm" tone="neutral">
                  预设
                </Badge>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'public_host',
      label: '公网入口',
      render: (_, service) => (
        <div className="min-w-0 wrap-anywhere">
          <span className="mr-2 min-[621px]:sr-only">公网</span>
          {service.public_host && service.public_port ? (
            <span className="font-mono text-(length:--text-xs) tabular-nums">
              {endpoint(service.public_host, service.public_port)}
            </span>
          ) : (
            <span className="text-(length:--text-xs) text-text-secondary">未登记</span>
          )}
        </div>
      ),
    },
    {
      key: 'listen_port',
      label: realm ? '监听与转发' : '监听与握手',
      numeric: false,
      render: (_, service) => (
        <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 text-(length:--text-xs) wrap-anywhere tabular-nums">
          <dt className="text-text-secondary">监听</dt>
          <dd className="font-mono">{endpoint(service.listen_host, service.listen_port)}</dd>
          <dt className="text-text-secondary">目标</dt>
          <dd className="font-mono">{endpoint(service.target_host, service.target_port)}</dd>
          {!realm && service.server_name && service.server_name !== service.target_host && (
            <>
              <dt className="text-text-secondary">SNI</dt>
              <dd>{service.server_name}</dd>
            </>
          )}
        </dl>
      ),
    },
    ...(!realm
      ? [
          {
            key: 'server_name',
            label: '关联中转',
            sortable: false,
            render: (_: unknown, service: EngineService) => {
              const info = relayOptions(service);
              if (!info.loaded) {
                return <span className="text-(length:--text-xs) text-text-muted">未读取</span>;
              }
              if (info.relays.length > 0) {
                const summary = summarizeServiceRelays(info.relays);
                const tone =
                  summary.attention > 0
                    ? 'danger'
                    : summary.pending > 0
                      ? 'warning'
                      : summary.available > 0
                        ? 'success'
                        : 'neutral';
                const label =
                  summary.attention > 0
                    ? `${summary.total} 条，${summary.attention} 需处理`
                    : summary.pending > 0
                      ? `${summary.total} 条，${summary.pending} 待确认`
                      : `${summary.total} 条可用`;
                return (
                  <button
                    type="button"
                    onClick={(e) => info.onInspect(e.currentTarget)}
                    className="inline-flex flex-col items-start gap-1 text-left"
                  >
                    <Badge size="sm" dot tone={tone}>
                      {label}
                    </Badge>
                  </button>
                );
              }
              if (info.enabled && !service.pending_delete) {
                return (
                  <Button size="sm" variant="ghost" onClick={(e) => info.onAdd(e.currentTarget)}>
                    <Waypoints size={14} strokeWidth={1.75} aria-hidden="true" />
                    添加中转
                  </Button>
                );
              }
              return (
                <span className="text-(length:--text-xs) text-text-secondary">
                  {service.public_host && service.public_port ? '发布后可中转' : '需登记公网入口'}
                </span>
              );
            },
          } satisfies DataColumn<EngineService>,
        ]
      : []),
    {
      key: 'enabled',
      label: '状态',
      sortable: false,
      width: 108,
      render: (_, service) =>
        service.pending_delete ? (
          <span className="text-(length:--text-xs) font-medium text-danger">待删除</span>
        ) : (
          <Checkbox
            label={service.enabled ? '启用' : '停用'}
            aria-label={`启用 ${service.name}`}
            checked={service.enabled}
            disabled={disabled || managedRelay(service.id)}
            onCheckedChange={(enabled) => patch(service, { enabled: enabled === true })}
          />
        ),
    },
    {
      key: 'actions',
      label: '操作',
      sortable: false,
      width: realm ? 124 : 216,
      render: (_, service) => {
        if (managedRelay(service.id))
          return (
            <Link
              className="text-(length:--text-xs) font-medium text-accent hover:underline"
              to={relayRoutePath(service.id)}
            >
              管理中转线路
            </Link>
          );
        const group = `${actionId}-${service.id}`;
        const menuTrigger = () =>
          document.getElementById(group)?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ??
          null;
        const info = relayOptions(service);
        return (
          <div
            id={group}
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label={`${service.name} 的操作`}
          >
            {!realm && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`查看 ${service.name} 的连接信息`}
                disabled={!canReveal || service.pending_delete}
                onClick={(event) => onReveal(service.id, event.currentTarget)}
              >
                连接信息
              </Button>
            )}
            <DropdownMenu
              label="更多"
              items={[
                {
                  label: realm ? '编辑转发规则' : '编辑服务',
                  icon: <Pencil size={16} aria-hidden="true" />,
                  disabled: disabled || service.pending_delete,
                  onSelect: () => onEdit(service, menuTrigger()),
                },
                ...(!realm
                  ? [
                      {
                        label: info.relays.length > 0 ? '管理关联中转' : '添加中转',
                        icon: <Waypoints size={16} aria-hidden="true" />,
                        disabled:
                          (info.relays.length === 0 && !info.enabled) || service.pending_delete,
                        onSelect: () =>
                          info.relays.length > 0
                            ? info.onInspect(menuTrigger())
                            : info.onAdd(menuTrigger()),
                      },
                      {
                        label: '更换凭证',
                        icon: <KeyRound size={16} aria-hidden="true" />,
                        disabled: !canRotate || service.pending_delete,
                        onSelect: () => onRotate(service, menuTrigger()),
                      },
                    ]
                  : []),
                {
                  label: service.pending_delete ? '撤销删除' : '标记删除',
                  icon: service.pending_delete ? (
                    <Undo2 size={16} aria-hidden="true" />
                  ) : (
                    <Trash2 size={16} aria-hidden="true" />
                  ),
                  disabled,
                  destructive: !service.pending_delete,
                  separatorBefore: true,
                  onSelect: () => patch(service, { pending_delete: !service.pending_delete }),
                },
              ]}
            />
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      rows={services.map((service) => ({ ...service }))}
      rowKey="id"
      caption={realm ? '手动转发规则' : '代理服务'}
      emptyMessage={realm ? '尚无手动转发规则' : '尚无代理服务'}
      emptyState={{ variant: 'unconfigured', headingLevel: 3 }}
      columns={columns}
    />
  );
}
