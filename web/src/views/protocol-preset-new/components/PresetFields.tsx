import { Layers, LockKeyhole, Plus, ScanFace, SlidersHorizontal, X } from 'lucide-react';
import { useRef } from 'react';
import type { PresetConfig } from '@/api/protocol-presets';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Select } from '@/components/arc/select/select';
import { SettingRow, SettingSection } from './SettingSection';

export interface ShortIDField {
  id: number;
  value: string;
}
const segmentStyle =
  'min-h-11 [--brand-gradient:var(--surface)] [--brand-ink:var(--foreground)] [--segmented-background:var(--surface-muted)] [--segmented-border:transparent] [--control-height-sm:44px]';
export default function PresetFields({
  value,
  setValue,
  shortIDs,
  setShortIDs,
}: {
  value: PresetConfig;
  setValue: (value: PresetConfig) => void;
  shortIDs: ShortIDField[];
  setShortIDs: (value: ShortIDField[]) => void;
}) {
  const nextID = useRef(0);
  const patch = (changes: Partial<PresetConfig>) => setValue({ ...value, ...changes });
  const text = (
    key: 'target' | 'server_name' | 'cdn_host' | 'path',
    label: string,
    placeholder: string,
  ) => (
    <Input
      label={label}
      hideLabel
      value={value[key]}
      placeholder={placeholder}
      maxLength={256}
      className="min-h-11 w-full"
      onChange={(e) => patch({ [key]: e.target.value })}
    />
  );
  return (
    <>
      <section
        className="space-y-5 rounded-(--radius-panel) border-[0.5px] border-border bg-surface p-5 sm:p-6"
        aria-label="协议与名称"
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-3 font-medium">
            <Layers size={18} strokeWidth={1.75} aria-hidden="true" />
            协议
          </h2>
          <span className="font-medium">VLESS</span>
        </div>
        <Input
          label="配置名称"
          value={value.name}
          maxLength={128}
          placeholder="例如 VLESS 443"
          className="min-h-12"
          description="显示在协议配置列表中。"
          onChange={(e) => patch({ name: e.target.value })}
        />
      </section>
      <SettingSection
        title="基础"
        icon={SlidersHorizontal}
        summary={`${value.port || '未填写端口'} / ${value.security.toUpperCase()}`}
      >
        <SettingRow title="TCP 端口" description="节点监听的端口，范围为 1 至 65535。">
          <div className="w-28">
            <Input
              label="TCP 端口"
              hideLabel
              inputMode="numeric"
              className="min-h-11 text-right tabular-nums"
              value={value.port || ''}
              maxLength={5}
              onChange={(e) => {
                if (/^\d*$/.test(e.target.value)) patch({ port: Number(e.target.value) });
              }}
            />
          </div>
        </SettingRow>
        <SettingRow
          title="传输方式"
          description="XHTTP 为默认传输。TCP 搭配 Vision 使用 REALITY，WebSocket 仅用于 TLS。"
        >
          <SegmentedControl
            className={segmentStyle}
            label="传输方式"
            value={value.transport}
            onValueChange={(transport) =>
              patch({
                transport: transport as PresetConfig['transport'],
                path: transport === 'tcp' ? '' : value.path || '/',
              })
            }
            options={[
              { value: 'xhttp', label: 'XHTTP' },
              value.security === 'reality'
                ? { value: 'tcp', label: 'TCP + Vision' }
                : { value: 'ws', label: 'WebSocket' },
            ]}
          />
        </SettingRow>
        <SettingRow
          title="传输层安全"
          description="REALITY 无需配置客户端信任的证书。TLS 使用节点证书，可放在 CDN 后。"
        >
          <SegmentedControl
            className={segmentStyle}
            label="传输层安全"
            value={value.security}
            onValueChange={(security) => {
              if (security === 'tls') {
                setShortIDs([]);
                patch({
                  security,
                  site: '',
                  target: '',
                  short_ids: [],
                  certificate: 'letsencrypt',
                  transport: value.transport === 'tcp' ? 'xhttp' : value.transport,
                  path: value.path || '/',
                });
              } else
                patch({
                  security: 'reality',
                  site: 'local',
                  certificate: '',
                  cdn_host: '',
                  transport: value.transport === 'ws' ? 'xhttp' : value.transport,
                });
            }}
            options={[
              { value: 'reality', label: 'REALITY' },
              { value: 'tls', label: 'TLS' },
            ]}
          />
        </SettingRow>
        {value.transport !== 'tcp' && (
          <SettingRow title="传输路径" description="以 / 开头，客户端与服务端使用相同路径。" wide>
            {text('path', '传输路径', '/')}
          </SettingRow>
        )}
        {value.security === 'reality' && (
          <>
            <SettingRow
              title="向其他访问者展示的站点"
              description="本节点站点使用节点自己的域名与证书；其他站点使用指定的 REALITY 握手目标。"
            >
              <SegmentedControl
                className={segmentStyle}
                label="向其他访问者展示的站点"
                value={value.site}
                onValueChange={(site) => patch({ site: site as PresetConfig['site'], target: '' })}
                options={[
                  { value: 'local', label: '本节点站点' },
                  { value: 'external', label: '其他站点' },
                ]}
              />
            </SettingRow>
            {value.site === 'external' && (
              <SettingRow
                title="目标（主机:端口）"
                description="指定真实站点。Agent 应用时会执行 DNS、连接与 TLS 握手预检。"
                wide
              >
                {text('target', '目标（主机:端口）', 'www.example.org:443')}
              </SettingRow>
            )}
          </>
        )}
      </SettingSection>
      {value.security === 'tls' && (
        <SettingSection title="TLS 和 CDN" icon={LockKeyhole}>
          <SettingRow
            title="源站证书"
            description="Let’s Encrypt 需要节点域名；自签名证书仅用于已配置 CDN 的源站。"
          >
            <SegmentedControl
              className={segmentStyle}
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
          </SettingRow>
          <SettingRow
            title="服务器名称（SNI）"
            description="节点证书对应的域名。留空时使用节点域名。"
            wide
          >
            {text('server_name', '服务器名称（SNI）', 'node.example.org')}
          </SettingRow>
          <SettingRow
            title="CDN 主机名"
            description="客户端连接的 CDN 地址。留空时直接连接节点。"
            wide
          >
            {text('cdn_host', 'CDN 主机名', 'cdn.example.org')}
          </SettingRow>
        </SettingSection>
      )}
      <SettingSection title="混淆" icon={ScanFace} summary={value.fingerprint}>
        {value.security === 'reality' && (
          <>
            {value.site === 'external' && (
              <SettingRow title="服务器名称（SNI）" description="填写握手目标证书对应的域名。" wide>
                {text('server_name', '服务器名称（SNI）', 'www.example.org')}
              </SettingRow>
            )}
            <SettingRow
              title="Short ID"
              description="偶数位十六进制，每项最多 16 位，最多 8 个。留空时每个服务独立生成。"
              wide
            >
              <div className="space-y-2">
                {shortIDs.map((field, index) => (
                  <div key={field.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <Input
                        label={`Short ID ${index + 1}`}
                        hideLabel
                        value={field.value}
                        maxLength={16}
                        placeholder="例如 a1b2c3d4"
                        className="min-h-11 font-mono"
                        onChange={(e) =>
                          setShortIDs(
                            shortIDs.map((item) =>
                              item.id === field.id ? { ...item, value: e.target.value } : item,
                            ),
                          )
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="size-11 shrink-0 p-0"
                      aria-label={`移除 Short ID ${index + 1}`}
                      onClick={() => setShortIDs(shortIDs.filter((item) => item.id !== field.id))}
                    >
                      <X size={16} aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    className="min-h-11"
                    disabled={shortIDs.length >= 8}
                    onClick={() => setShortIDs([...shortIDs, { id: nextID.current++, value: '' }])}
                  >
                    <Plus size={16} aria-hidden="true" />
                    添加
                  </Button>
                  <span className="text-(length:--text-xs) text-text-secondary tabular-nums">
                    {shortIDs.length} / 8
                  </span>
                </div>
              </div>
            </SettingRow>
          </>
        )}
        <SettingRow title="客户端指纹" description="客户端 TLS 握手所模仿的浏览器。" wide>
          <Select
            label="客户端指纹"
            hideLabel
            value={value.fingerprint}
            onValueChange={(fingerprint) => patch({ fingerprint })}
            options={[
              { value: 'chrome', label: 'Chrome' },
              { value: 'firefox', label: 'Firefox' },
              { value: 'safari', label: 'Safari' },
              { value: 'edge', label: 'Edge' },
              { value: 'randomized', label: '随机' },
            ]}
          />
        </SettingRow>
      </SettingSection>
    </>
  );
}
