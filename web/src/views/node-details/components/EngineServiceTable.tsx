import { useId } from 'react';
import type { EngineService } from '@/api/engines';
import { Button } from '@/components/arc/button/button';
import { DropdownMenu } from '@/components/arc/dropdown-menu/dropdown-menu';
import { SortableDataTable } from '@/components/arc/sortable-data-table/sortable-data-table';
import { Switch } from '@/components/arc/switch/switch';

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
  onEdit: (service: EngineService) => void;
  onReveal: (id: string) => void;
  onRotate: (service: EngineService, trigger: HTMLElement | null) => void;
  canRotate: boolean;
}) {
  const actionId = useId();
  function patch(service: EngineService, changes: Partial<EngineService>) {
    onUpdate(services.map((item) => (item.id === service.id ? { ...item, ...changes } : item)));
  }
  return (
    <div className="v-card">
      <SortableDataTable
        rows={services.map((service) => ({ ...service }))}
        rowKey="id"
        caption={realm ? 'TCP 转发规则' : '代理服务'}
        emptyMessage="尚无配置，请添加服务后保存草稿并应用。"
        itemName={{ one: realm ? '条规则' : '项服务', other: realm ? '条规则' : '项服务' }}
        columns={[
          {
            key: 'enabled',
            label: '启用',
            sortable: false,
            width: 76,
            render: (_, service) => (
              <Switch
                aria-label={`启用 ${service.name}`}
                checked={service.enabled && !service.pending_delete}
                disabled={disabled || service.pending_delete}
                onCheckedChange={(enabled) => patch(service, { enabled })}
              />
            ),
          },
          {
            key: 'name',
            label: '服务名称与协议',
            render: (_, service) => (
              <div className="min-w-0 space-y-1 wrap-anywhere">
                <p
                  className={
                    service.pending_delete ? 'text-text-secondary line-through' : 'font-medium'
                  }
                >
                  {service.name}
                </p>
                <p className="text-(length:--text-xs) text-text-secondary">
                  {realm ? 'TCP 端口转发' : 'VLESS + TCP + REALITY'}
                </p>
                {service.pending_delete && <span className="text-danger">待删除</span>}
              </div>
            ),
          },
          {
            key: 'listen_port',
            label: '本地监听',
            render: (_, service) => (
              <span className="tabular-nums wrap-anywhere">
                {endpoint(service.listen_host, service.listen_port)}
              </span>
            ),
          },
          {
            key: 'target_host',
            label: realm ? '转发目标' : '握手目标与 SNI',
            render: (_, service) => (
              <div className="tabular-nums wrap-anywhere">
                {endpoint(service.target_host, service.target_port)}
                {!realm && (
                  <p className="text-(length:--text-xs) text-text-secondary">
                    SNI: {service.server_name}
                  </p>
                )}
              </div>
            ),
          },
          {
            key: 'public_host',
            label: '对外公网入口',
            render: (_, service) => (
              <span className="tabular-nums wrap-anywhere">
                {service.public_host && service.public_port
                  ? endpoint(service.public_host, service.public_port)
                  : '未登记公网入口'}
              </span>
            ),
          },
          {
            key: 'actions',
            label: '操作',
            sortable: false,
            render: (_, service) => (
              <div id={`${actionId}-${service.id}`} className="flex flex-wrap gap-2">
                {!realm && (
                  <Button
                    variant="ghost"
                    className="min-h-11"
                    disabled={!canReveal || service.pending_delete}
                    onClick={() => onReveal(service.id)}
                  >
                    连接
                  </Button>
                )}
                <Button
                  variant="secondary"
                  className="min-h-11"
                  disabled={disabled || service.pending_delete}
                  onClick={() => onEdit(service)}
                >
                  编辑
                </Button>
                <DropdownMenu
                  label="服务操作"
                  items={[
                    ...(!realm
                      ? [
                          {
                            label: '更换凭证',
                            disabled: !canRotate || service.pending_delete,
                            onSelect: () =>
                              onRotate(
                                service,
                                document
                                  .getElementById(`${actionId}-${service.id}`)
                                  ?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? null,
                              ),
                          },
                        ]
                      : []),
                    {
                      label: service.pending_delete ? '撤销删除' : '标记删除',
                      disabled,
                      destructive: !service.pending_delete,
                      onSelect: () => patch(service, { pending_delete: !service.pending_delete }),
                    },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
