import { KeyRound, Pencil, Trash2, Undo2 } from 'lucide-react';
import { useId } from 'react';
import type { EngineService } from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import DataTable from '@/components/data-table';

const endpoint = (host: string, port: number) =>
  `${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;

export default function EngineServiceTable({
  services,
  realm,
  disabled,
  canReveal,
  onUpdate,
  onEdit,
  onReveal,
  onRotate,
  canRotate,
}: {
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

  return (
    <DataTable
      rows={services.map((service) => ({ ...service }))}
      rowKey="id"
      caption={realm ? 'TCP 转发规则' : '代理服务'}
      emptyMessage={realm ? '尚无转发规则' : '尚无代理服务'}
      emptyState={{ variant: 'unconfigured', headingLevel: 3 }}
      columns={[
        {
          key: 'name',
          label: realm ? '规则名称' : '服务名称',
          render: (_, service) => (
            <div className="min-w-0 space-y-1 wrap-anywhere">
              <p className="font-medium">{service.name}</p>
              {!realm && <p className="text-(length:--text-xs) text-text-secondary">VLESS</p>}
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
                <span className="tabular-nums">
                  {endpoint(service.public_host, service.public_port)}
                </span>
              ) : (
                <span className="text-text-secondary">未登记</span>
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
              <dd>{endpoint(service.listen_host, service.listen_port)}</dd>
              <dt className="text-text-secondary">目标</dt>
              <dd>{endpoint(service.target_host, service.target_port)}</dd>
              {!realm && service.server_name && service.server_name !== service.target_host && (
                <>
                  <dt className="text-text-secondary">SNI</dt>
                  <dd>{service.server_name}</dd>
                </>
              )}
            </dl>
          ),
        },
        {
          key: 'enabled',
          label: '状态',
          sortable: false,
          width: 108,
          render: (_, service) =>
            service.pending_delete ? (
              <span className="text-(length:--text-xs) text-danger">待删除</span>
            ) : (
              <Checkbox
                label={service.enabled ? '启用' : '停用'}
                aria-label={`启用 ${service.name}`}
                checked={service.enabled}
                disabled={disabled}
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
            const group = `${actionId}-${service.id}`;
            const menuTrigger = () =>
              document
                .getElementById(group)
                ?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? null;
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
      ]}
    />
  );
}
