import { Pencil } from 'lucide-react';
import { engineNames } from '@/api/engines';
import { type ProtocolPreset, transportLabel } from '@/api/protocol-presets';
import { Button } from '@/components/arc/button/button';
import { CopyButton } from '@/components/arc/copy-button/copy-button';
import { Drawer, DrawerContent, useDrawerItem } from '@/components/arc/drawer/drawer';

export default function PresetInspectorDrawer({
  preset,
  canManage,
  onClose,
  onEdit,
  returnFocus,
}: {
  preset: ProtocolPreset | null;
  canManage: boolean;
  onClose: () => void;
  onEdit: (preset: ProtocolPreset) => void;
  returnFocus: () => void;
}) {
  const item = useDrawerItem(preset);
  const config = item?.config;

  return (
    <Drawer
      open={preset !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent
        title={config?.name ?? '协议配置详情'}
        description={
          config
            ? `VLESS ${transportLabel(config.transport)} ${config.security.toUpperCase()}`
            : undefined
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
              <Button
                className="ml-2"
                type="button"
                disabled={!canManage}
                onClick={() => onEdit(item)}
              >
                <Pencil size={16} strokeWidth={1.75} aria-hidden="true" />
                编辑此配置
              </Button>
            </>
          ) : undefined
        }
      >
        {item && config && (
          <div className="space-y-6">
            <section aria-label="引擎引用兼容性" className="space-y-2.5">
              <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
                引擎引用兼容性
              </h3>
              <dl className="divide-y-[1px] divide-border-subtle rounded-(--radius-control) border-[1px] border-border bg-background">
                {engineNames.map((engine) => {
                  const issue = item.reference_issues?.[engine];
                  const supported = issue === '';
                  return (
                    <div
                      key={engine}
                      className="flex items-start justify-between gap-3 px-3.5 py-2.5"
                    >
                      <dt className="shrink-0 text-(length:--text-xs) font-medium text-foreground">
                        {engine}
                      </dt>
                      <dd
                        className={`text-right text-(length:--text-xs) ${
                          supported ? 'font-medium text-success' : 'text-text-secondary'
                        }`}
                      >
                        {supported ? '可用于节点草稿' : issue || '兼容性未知'}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>

            <section aria-label="共享参数明细" className="space-y-2.5">
              <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
                共享参数明细
              </h3>
              <dl className="divide-y-[1px] divide-border-subtle rounded-(--radius-control) border-[1px] border-border bg-background">
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                    默认 TCP 端口
                  </dt>
                  <dd className="font-mono text-(length:--text-xs) tabular-nums text-foreground">
                    {config.port}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">传输方式</dt>
                  <dd className="text-(length:--text-xs) text-foreground">
                    {transportLabel(config.transport)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                    传输层安全
                  </dt>
                  <dd className="text-(length:--text-xs) text-foreground">
                    {config.security.toUpperCase()}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                  <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                    客户端指纹
                  </dt>
                  <dd className="font-mono text-(length:--text-xs) text-foreground">
                    {config.fingerprint}
                  </dd>
                </div>
                {config.transport !== 'tcp' && (
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                      传输路径
                    </dt>
                    <dd className="font-mono text-(length:--text-xs) text-foreground wrap-anywhere text-right">
                      {config.path || '/'}
                    </dd>
                  </div>
                )}
                {config.security === 'reality' ? (
                  <>
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                        伪装握手站点
                      </dt>
                      <dd className="text-(length:--text-xs) text-foreground">
                        {config.site === 'external' ? '外部站点' : '本节点站点'}
                      </dd>
                    </div>
                    {config.site === 'external' && (
                      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                        <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                          握手目标
                        </dt>
                        <dd className="font-mono text-(length:--text-xs) text-foreground wrap-anywhere text-right">
                          {config.target || '未设置'}
                        </dd>
                      </div>
                    )}
                    {config.server_name && (
                      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                        <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                          默认 SNI
                        </dt>
                        <dd className="font-mono text-(length:--text-xs) text-foreground wrap-anywhere text-right">
                          {config.server_name}
                        </dd>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                        源站证书
                      </dt>
                      <dd className="text-(length:--text-xs) text-foreground">
                        {config.certificate === 'self_signed' ? '自签名' : 'Let’s Encrypt'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                        服务器名称（SNI）
                      </dt>
                      <dd className="font-mono text-(length:--text-xs) text-foreground wrap-anywhere text-right">
                        {config.server_name || '跟随节点域名'}
                      </dd>
                    </div>
                    {config.cdn_host && (
                      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                        <dt className="shrink-0 text-(length:--text-xs) text-text-secondary">
                          CDN 主机名
                        </dt>
                        <dd className="font-mono text-(length:--text-xs) text-foreground wrap-anywhere text-right">
                          {config.cdn_host}
                        </dd>
                      </div>
                    )}
                  </>
                )}
              </dl>
            </section>

            {config.security === 'reality' && (
              <section aria-label="Short ID 列表" className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
                    Short ID 列表
                  </h3>
                  <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                    {config.short_ids.length} / 8
                  </span>
                </div>
                {config.short_ids.length === 0 ? (
                  <p className="text-(length:--text-xs) text-text-secondary">未设置 Short ID</p>
                ) : (
                  <ul className="divide-y-[1px] divide-border-subtle rounded-(--radius-control) border-[1px] border-border bg-background">
                    {config.short_ids.map((sid) => (
                      <li key={sid} className="flex items-center justify-between gap-2 px-3.5 py-2">
                        <span className="font-mono text-(length:--text-xs) text-foreground">
                          {sid}
                        </span>
                        <CopyButton
                          value={sid}
                          label={`复制 Short ID ${sid}`}
                          iconOnly
                          variant="plain"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <p className="text-(length:--text-xs) leading-relaxed text-text-secondary">
              预设仅保存非敏感共享参数，不含 UUID、REALITY 私钥与节点对外地址。
            </p>
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
