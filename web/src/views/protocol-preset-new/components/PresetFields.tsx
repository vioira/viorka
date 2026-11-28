import { Plus, X } from 'lucide-react';
import { useRef } from 'react';
import type { PresetConfig } from '@/api/protocol-presets';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { ClientFingerprintSelect } from '@/components/ClientFingerprintSelect';

import { defaultSNI, type PresetDraft, type ShortIDField } from '../preset-validation';

export default function PresetFields({
  value,
  editing = false,
  invalidField,
  setValue,
  shortIDs,
  setShortIDs,
}: {
  value: PresetDraft;
  invalidField?: string;
  editing?: boolean;
  setValue: (value: PresetDraft) => void;
  shortIDs: ShortIDField[];
  setShortIDs: (value: ShortIDField[]) => void;
}) {
  const nextID = useRef(0);
  const patch = (changes: Partial<PresetDraft>) => setValue({ ...value, ...changes });

  const fieldProps = (name: string) => ({
    name,
    'aria-invalid': invalidField === name || undefined,
  });
  const transportOptions =
    value.security === 'reality'
      ? [
          { value: 'tcp', label: 'TCP + Vision' },
          { value: 'xhttp', label: 'XHTTP' },
        ]
      : [
          { value: 'xhttp', label: 'XHTTP' },
          { value: 'ws', label: 'WebSocket' },
        ];

  return (
    <div className="min-w-0 space-y-5">
      <section
        aria-label="标识与监听端口"
        className="overflow-hidden rounded-(--radius-surface) border-[1px] border-border bg-surface"
      >
        <div className="flex items-center justify-between gap-3 border-b-[1px] border-border-subtle px-5 py-3.5">
          <h3 className="text-(length:--text-sm) font-medium text-foreground">标识与监听端口</h3>
          <Badge size="sm" tone="neutral">
            VLESS
          </Badge>
        </div>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_9.5rem]">
          <Input
            {...fieldProps('name')}
            label="配置名称"
            value={value.name}
            placeholder="例如 VLESS Reality 443"
            onChange={(event) => patch({ name: event.target.value })}
          />
          <Input
            {...fieldProps('port')}
            label="默认 TCP 端口"
            inputMode="numeric"
            className="font-mono tabular-nums"
            value={value.port}
            placeholder="443"
            onChange={(event) => patch({ port: event.target.value })}
          />
        </div>
      </section>

      <section
        aria-label="传输层安全与传输方式"
        className="overflow-hidden rounded-(--radius-surface) border-[1px] border-border bg-surface"
      >
        <div className="border-b-[1px] border-border-subtle px-5 py-3.5">
          <h3 className="text-(length:--text-sm) font-medium text-foreground">
            传输层安全与传输方式
          </h3>
        </div>
        <div className="divide-y-[1px] divide-border-subtle">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-0 flex-1">
              <p className="text-(length:--text-sm) font-medium text-foreground">传输层安全</p>
              <p className="mt-1 text-(length:--text-xs) text-text-secondary">
                REALITY 无需签发域名证书；TLS 使用节点证书并支持经 CDN 回源。
              </p>
            </div>
            <SegmentedControl
              label="传输层安全"
              value={value.security}
              onValueChange={(security) => {
                if (security === 'tls') {
                  setShortIDs([]);
                  patch({
                    security: 'tls',
                    site: '',
                    target: '',
                    short_ids: [],
                    certificate: 'letsencrypt',
                    transport: value.transport === 'tcp' ? 'xhttp' : value.transport,
                    path: value.path || '/',
                  });
                } else {
                  patch({
                    security: 'reality',
                    site: 'external',
                    certificate: '',
                    cdn_host: '',
                    transport: value.transport === 'ws' ? 'tcp' : value.transport,
                    path: value.transport === 'ws' ? '' : value.path,
                  });
                }
              }}
              options={[
                { value: 'reality', label: 'REALITY' },
                { value: 'tls', label: 'TLS' },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-0 flex-1">
              <p className="text-(length:--text-sm) font-medium text-foreground">传输方式</p>
              <p className="mt-1 text-(length:--text-xs) text-text-secondary">
                {value.security === 'reality'
                  ? 'TCP 搭配 Vision 为当前节点可执行组合。'
                  : 'WebSocket 与 XHTTP 可搭配 TLS。'}
              </p>
            </div>
            <SegmentedControl
              label="传输方式"
              value={value.transport}
              onValueChange={(transport) =>
                patch({
                  transport: transport as PresetConfig['transport'],
                  path: transport === 'tcp' ? '' : value.path || '/',
                })
              }
              options={transportOptions}
            />
          </div>

          {value.transport !== 'tcp' && (
            <div className="p-5">
              <Input
                {...fieldProps('path')}
                label="传输路径"
                value={value.path}
                placeholder="/"
                className="font-mono"
                description="须以 / 开头，客户端与服务端使用相同路径。"
                onChange={(event) => patch({ path: event.target.value })}
              />
            </div>
          )}

          {value.security === 'reality' ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="min-w-0 flex-1">
                  <p className="text-(length:--text-sm) font-medium text-foreground">
                    伪装握手站点
                  </p>
                  <p className="mt-1 text-(length:--text-xs) text-text-secondary">
                    当前执行链路仅支持外部握手目标站点。
                  </p>
                </div>
                <SegmentedControl
                  label="伪装握手站点"
                  value={value.site}
                  onValueChange={(site) =>
                    patch({
                      site: site as PresetConfig['site'],
                      target: site === 'local' ? '' : value.target,
                      server_name: '',
                    })
                  }
                  options={[
                    { value: 'external', label: '外部站点' },
                    { value: 'local', label: '本节点站点' },
                  ]}
                />
              </div>
              <div className="grid grid-cols-1 items-start gap-4 p-5 sm:grid-cols-2">
                {value.site === 'external' && (
                  <Input
                    {...fieldProps('target')}
                    label="握手目标"
                    value={value.target}
                    placeholder="example.org:443"
                    className="font-mono"
                    onChange={(event) => patch({ target: event.target.value })}
                  />
                )}
                <Input
                  {...fieldProps('server_name')}
                  label="服务器名称（SNI）"
                  value={value.server_name}
                  placeholder={defaultSNI(value.target) || 'example.org'}
                  className="font-mono"
                  description={
                    value.site === 'external'
                      ? '留空时使用握手目标域名。目标为 IP 时须填写域名。'
                      : undefined
                  }
                  onChange={(event) => patch({ server_name: event.target.value })}
                />
              </div>
            </>
          ) : (
            <div className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="text-(length:--text-sm) font-medium text-foreground">源站证书</p>
                  <p className="mt-1 text-(length:--text-xs) text-text-secondary">
                    Let’s Encrypt 需要节点域名；自签名证书须同时填写 CDN 主机名。
                  </p>
                </div>
                <SegmentedControl
                  label="源站证书"
                  value={value.certificate}
                  onValueChange={(certificate) =>
                    patch({ certificate: certificate as PresetConfig['certificate'] })
                  }
                  options={[
                    { value: 'letsencrypt', label: 'Let’s Encrypt' },
                    { value: 'self_signed', label: '自签名' },
                  ]}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  {...fieldProps('server_name')}
                  label="服务器名称（SNI）"
                  value={value.server_name}
                  placeholder="node.example.org"
                  className="font-mono"
                  description="留空时使用节点域名。"
                  onChange={(event) => patch({ server_name: event.target.value })}
                />
                <Input
                  label={
                    value.certificate === 'self_signed'
                      ? 'CDN 主机名（必填）'
                      : 'CDN 主机名（可选）'
                  }
                  {...fieldProps('cdn_host')}
                  value={value.cdn_host}
                  placeholder="cdn.example.org"
                  className="font-mono"
                  description={
                    value.certificate === 'self_signed' ? undefined : '留空时直接连接节点。'
                  }
                  onChange={(event) => patch({ cdn_host: event.target.value })}
                />
              </div>
            </div>
          )}
        </div>
      </section>

      <section
        aria-label="客户端指纹与混淆参数"
        className="overflow-hidden rounded-(--radius-surface) border-[1px] border-border bg-surface"
      >
        <div className="border-b-[1px] border-border-subtle px-5 py-3.5">
          <h3 className="text-(length:--text-sm) font-medium text-foreground">
            客户端指纹与混淆参数
          </h3>
        </div>
        <div className="divide-y-[1px] divide-border-subtle">
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div className="min-w-0 flex-1">
              <p className="text-(length:--text-sm) font-medium text-foreground">TLS 客户端指纹</p>
              <p className="mt-1 text-(length:--text-xs) text-text-secondary">
                当前执行链路仅支持 Chrome 指纹。
              </p>
            </div>
            <div className="w-full sm:w-48">
              <ClientFingerprintSelect
                hideLabel
                value={value.fingerprint}
                onValueChange={(fingerprint) => patch({ fingerprint })}
              />
            </div>
          </div>

          {value.security === 'reality' && (
            <div className="space-y-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-(length:--text-sm) font-medium text-foreground">Short ID</p>
                  <p className="mt-1 text-(length:--text-xs) text-text-secondary">
                    {editing
                      ? '偶数位十六进制（2 至 16 位），最多 8 个；全部留空时保留原有列表。'
                      : '偶数位十六进制（2 至 16 位），最多 8 个；留空保存时自动生成 2 组。'}
                  </p>
                </div>
                <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                  {shortIDs.length} / 8
                </span>
              </div>

              {shortIDs.length > 0 && (
                <div className="space-y-2">
                  {shortIDs.map((field, index) => (
                    <div key={field.id} className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <Input
                          label={`Short ID ${index + 1}`}
                          hideLabel
                          value={field.value}
                          placeholder="例如 a1b2c3d4"
                          className="font-mono"
                          {...fieldProps(`short-id-${field.id}`)}
                          onChange={(event) =>
                            setShortIDs(
                              shortIDs.map((item) =>
                                item.id === field.id
                                  ? { ...item, value: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        className="shrink-0"
                        aria-label={`移除 Short ID ${index + 1}`}
                        onClick={() => setShortIDs(shortIDs.filter((item) => item.id !== field.id))}
                      >
                        <X size={16} strokeWidth={1.75} aria-hidden="true" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={shortIDs.length >= 8}
                  onClick={() =>
                    setShortIDs([
                      ...shortIDs,
                      {
                        id: Math.max(nextID.current++, ...shortIDs.map((field) => field.id + 1)),
                        value: '',
                      },
                    ])
                  }
                >
                  <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
                  添加 Short ID
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
