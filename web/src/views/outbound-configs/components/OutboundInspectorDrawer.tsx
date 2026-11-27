import { Pencil } from 'lucide-react';
import type { Outbound, OutboundConfig } from '@/api/outbounds';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent, useDrawerItem } from '@/components/arc/drawer/drawer';

export function outboundProtocolLabel(config: OutboundConfig) {
  if (config.type === 'socks') return 'SOCKS5';
  if (config.type === 'http') return config.tls ? 'HTTP CONNECT (TLS)' : 'HTTP CONNECT (明文)';
  return config.tls ? 'VLESS TCP + REALITY' : 'VLESS TCP (无 TLS)';
}

export function outboundCredentialStatus(outbound: Outbound) {
  if (outbound.config.type === 'vless') {
    return outbound.has_uuid ? '已加密保存 UUID' : '未设置 UUID';
  }
  if (!outbound.config.username) return '无认证';
  return outbound.has_password ? '已加密保存认证' : '仅用户名';
}

export default function OutboundInspectorDrawer({
  outbound,
  canManage,
  onClose,
  onEdit,
  returnFocus,
}: {
  outbound: Outbound | null;
  canManage: boolean;
  onClose: () => void;
  onEdit: (outbound: Outbound) => void;
  returnFocus: () => void;
}) {
  const item = useDrawerItem(outbound);
  const config = item?.config;

  return (
    <Drawer
      open={outbound !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        title={config?.name ?? '出口配置详情'}
        description={
          item && config ? `${outboundProtocolLabel(config)}（版本 v${item.version}）` : undefined
        }
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
        footer={
          item ? (
            <>
              <Button type="button" variant="secondary" onClick={onClose}>
                关闭
              </Button>
              <Button type="button" disabled={!canManage} onClick={() => onEdit(item)}>
                <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
                编辑出口配置
              </Button>
            </>
          ) : undefined
        }
      >
        {item && config && (
          <div className="space-y-6">
            <section aria-label="脱敏配置明细" className="space-y-2.5">
              <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
                脱敏配置明细
              </h3>
              <dl className="divide-y-[1px] divide-border-subtle rounded-(--radius-control) border-[1px] border-border bg-background">
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                    目标服务器
                  </dt>
                  <dd className="font-mono text-(length:--text-xs) tabular-nums text-foreground wrap-anywhere text-right">
                    {config.server}:{config.server_port}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                    引用节点数
                  </dt>
                  <dd className="text-(length:--text-xs) tabular-nums text-foreground">
                    {item.references} 个节点
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">凭证状态</dt>
                  <dd className="text-(length:--text-xs) text-foreground">
                    {outboundCredentialStatus(item)}
                  </dd>
                </div>
                {config.type === 'vless' && config.tls && (
                  <>
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">SNI</dt>
                      <dd className="font-mono text-(length:--text-xs) text-foreground wrap-anywhere text-right">
                        {config.server_name || '未设置'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">Flow</dt>
                      <dd className="font-mono text-(length:--text-xs) text-foreground">
                        {config.flow || '未启用'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                        客户端指纹
                      </dt>
                      <dd className="font-mono text-(length:--text-xs) text-foreground">
                        {config.fingerprint || 'chrome'}
                      </dd>
                    </div>
                  </>
                )}
                {config.type === 'http' && config.tls && config.server_name && (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                      TLS 服务器名称
                    </dt>
                    <dd className="font-mono text-(length:--text-xs) text-foreground wrap-anywhere text-right">
                      {config.server_name}
                    </dd>
                  </div>
                )}
              </dl>
            </section>

            <section
              aria-label="使用边界说明"
              className="space-y-1.5 rounded-(--radius-control) border-[1px] border-border bg-background p-4 text-(length:--text-xs) leading-relaxed text-text-secondary"
            >
              <h3 className="font-medium text-foreground">使用边界说明</h3>
              <p>节点草稿仅引用此出口 ID，不支持节点级参数覆盖。</p>
              <p>控制平面不执行出口连通性探测，代理失效时不会自动降级直连。</p>
              {config.type === 'http' && (
                <p className="text-warning">
                  HTTP CONNECT 仅允许用于显式 TCP 分流规则，不能作为默认出口。
                </p>
              )}
            </section>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
