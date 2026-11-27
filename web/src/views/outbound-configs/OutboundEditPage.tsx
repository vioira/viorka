import { Link2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutletContext, useParams } from 'react-router';
import type { Session } from '@/api/auth';
import {
  allOutbounds,
  newOutbound,
  type Outbound,
  type OutboundConfig,
  type OutboundPreview,
  parseOutbound,
  previewOutbound,
  saveOutbound,
} from '@/api/outbounds';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Input } from '@/components/arc/input/input';
import { PasswordField } from '@/components/arc/password-field/password-field';
import SegmentedControl from '@/components/arc/segmented-control/segmented-control';
import { Select } from '@/components/arc/select/select';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { ClientFingerprintSelect } from '@/components/ClientFingerprintSelect';
import EmptyStates from '@/components/empty-states';
import InitialSkeleton from '@/components/initial-skeleton';
import ProxyWorkbench from '@/components/proxy/ProxyWorkbench';
import OutboundImpactDialog from './components/OutboundImpactDialog';
import {
  type OutboundDraft,
  shadowsocksMethods,
  validateOutboundDraft,
} from './outbound-validation';

const choiceRowClass =
  'flex min-w-0 flex-col items-start gap-2 border-t-[1px] border-border-subtle pt-4 @xl:flex-row @xl:items-center @xl:justify-between @xl:gap-4';

function normalizeConfig(config: OutboundConfig): OutboundDraft {
  return {
    ...config,
    server_port: String(config.server_port),
    username: config.username ?? '',
    password: config.password ?? '',
    uuid: config.uuid ?? '',
    server_name: config.server_name ?? '',
    public_key: config.public_key ?? '',
    short_id: config.short_id ?? '',
    flow: config.flow ?? '',
    fingerprint: config.fingerprint ?? '',
  };
}

export default function OutboundEditPage() {
  const { outboundId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const formId = useId();
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const canManage = session.user.role !== 'viewer';

  const initialFromState = (location.state as { initialOutbound?: Outbound } | null)
    ?.initialOutbound;
  const matchedInitial =
    outboundId && initialFromState?.id === outboundId ? initialFromState : null;

  const [outbound, setOutbound] = useState<Outbound | null>(matchedInitial);
  const [loading, setLoading] = useState(Boolean(outboundId && !matchedInitial));
  const [notFound, setNotFound] = useState(false);

  const [config, setConfig] = useState<OutboundDraft>(() =>
    normalizeConfig(matchedInitial?.config ?? newOutbound()),
  );
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(normalizeConfig(matchedInitial?.config ?? newOutbound())),
  );
  const [invalidField, setInvalidField] = useState<keyof OutboundDraft | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<OutboundPreview | null>(null);

  const lock = useRef(false);
  const saveButton = useRef<HTMLButtonElement>(null);
  const controller = useRef<AbortController | null>(null);

  const loadOutbound = useCallback(async () => {
    if (!outboundId) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setNotFound(false);
    try {
      const items = await allOutbounds(abort.signal);
      if (abort.signal.aborted) return;
      const found = items.find((item) => item.id === outboundId) ?? null;
      if (!found) {
        setOutbound(null);
        setNotFound(true);
        return;
      }
      const normalized = normalizeConfig(found.config);
      setOutbound(found);
      setConfig(normalized);
      setInvalidField(null);
      setBaseline(JSON.stringify(normalized));
      setPreview(null);
    } catch (error) {
      if (!abort.signal.aborted) {
        toast({
          id: `outbound-load-${outboundId}`,
          type: 'error',
          title: '未能读取出口配置',
          description: error instanceof Error ? error.message : '请重新读取配置后重试。',
        });
      }
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }, [outboundId, toast]);

  useEffect(() => {
    if (outboundId && !matchedInitial) void loadOutbound();
    return () => controller.current?.abort();
  }, [outboundId, matchedInitial, loadOutbound]);

  function patch(changes: Partial<OutboundDraft>) {
    if (invalidField && (invalidField in changes || 'tls' in changes)) setInvalidField(null);
    setConfig((previous) => ({ ...previous, ...changes }));
    setPreview(null);
  }

  async function runAction(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await task();
    } catch (error) {
      toast({
        id: 'outbound-edit',
        type: 'error',
        title: '未能完成出口配置',
        description: error instanceof Error ? error.message : '请检查参数后重试。',
      });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const savedCredentials = outbound?.config.type === config.type ? outbound : null;
  const payload: OutboundConfig = { ...config, server_port: Number(config.server_port) };

  function fieldProps(name: keyof OutboundDraft) {
    return { name, 'aria-invalid': invalidField === name || undefined };
  }

  async function commitSave(confirmation = '') {
    await saveOutbound(outbound, payload, confirmation, session);
    setBaseline(JSON.stringify(config));
    setPreview(null);
    toast({
      type: 'success',
      title: '出口配置已保存',
      description: outbound ? '已发布的引用节点将同步最新配置。' : '可在节点的出口标签中添加引用。',
    });
    await navigate('/proxy/outbounds');
  }

  async function handleParseLink() {
    if (!link.trim()) return;
    await runAction(async () => {
      const parsed = normalizeConfig(await parseOutbound(link, session));
      setConfig(parsed);
      setInvalidField(null);
      setLink('');
      setPreview(null);
      toast({
        type: 'success',
        title: '链接已解析',
        description: '请检查下方参数后保存出口。',
      });
    });
  }

  const dirty = JSON.stringify(config) !== baseline;
  const formDisabled =
    busy || loading || notFound || (Boolean(outboundId) && !outbound) || !canManage;

  return (
    <ProxyWorkbench
      parentLabel="出口配置"
      parentPath="/proxy/outbounds"
      breadcrumbLabel={outboundId ? '编辑出口配置' : '新建出口配置'}
      title={outboundId ? `编辑出口配置${config.name ? `：${config.name}` : ''}` : '新建出口配置'}
      subtitle={
        outboundId ? '保存前预览受影响节点，节点仅引用共享出口，不支持节点级覆盖。' : undefined
      }
      meta={
        outbound ? (
          <Badge size="sm" tone="neutral" className="tabular-nums">
            v{outbound.version}
          </Badge>
        ) : undefined
      }
      form={formId}
      saveLabel={outboundId ? '预览影响并保存' : '保存出口配置'}
      saveButtonRef={saveButton}
      busy={busy}
      disabled={formDisabled}
      dirty={dirty && !busy}
      backLabel="返回出口配置"
      onClose={() => void navigate('/proxy/outbounds')}
      actions={
        outboundId ? (
          <Button
            type="button"
            variant="secondary"
            loading={loading}
            disabled={busy || loading}
            onClick={() => void loadOutbound()}
          >
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" />
            重新读取
          </Button>
        ) : undefined
      }
    >
      {notFound ? (
        <div className="v-card">
          <EmptyStates
            variant="not-found"
            title="未找到该出口配置"
            description="该出口可能已被删除，或你无权访问。"
            action={
              <Button variant="secondary" onClick={() => navigate('/proxy/outbounds')}>
                返回出口配置
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
          <div className="@container min-w-0 space-y-5">
            {outboundId && !outbound ? (
              <div className="v-card min-h-72" role="status">
                {loading ? (
                  <InitialSkeleton label="正在读取出口配置" lines={5} />
                ) : (
                  <p className="text-(length:--text-sm) text-text-secondary">
                    出口配置尚未读取，请使用上方「重新读取」。
                  </p>
                )}
              </div>
            ) : (
              <>
                <section
                  aria-label="从链接填入"
                  className="space-y-3 rounded-(--radius-surface) border-[1px] border-border bg-surface p-4 @xl:p-5"
                >
                  <fieldset disabled={formDisabled} className="min-w-0 space-y-3">
                    <div className="grid min-w-0 gap-3 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-end">
                      <div className="min-w-0">
                        <PasswordField
                          label="从链接填入"
                          value={link}
                          maxLength={8192}
                          autoComplete="off"
                          placeholder="粘贴 ss:// 或 vless:// 链接"
                          onChange={(event) => setLink(event.target.value)}
                          messages={{ showPassword: '显示链接', hidePassword: '隐藏链接' }}
                        />
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={formDisabled || !link.trim()}
                        onClick={() => void handleParseLink()}
                      >
                        <Link2 size={16} strokeWidth={1.75} aria-hidden="true" />
                        解析并填入
                      </Button>
                    </div>
                    <p className="text-(length:--text-xs) text-text-secondary">
                      解析后可检查并修改参数，再保存出口。
                    </p>
                  </fieldset>
                </section>

                <form
                  id={formId}
                  noValidate
                  className="min-w-0 space-y-5"
                  aria-busy={busy || loading}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (formDisabled) return;
                    const issue = validateOutboundDraft(config, outbound);
                    if (issue) {
                      setInvalidField(issue.field);
                      const field = event.currentTarget.elements.namedItem(issue.field);
                      if (field instanceof HTMLElement) field.focus();
                      toast({
                        id: 'outbound-validation',
                        type: 'error',
                        title: '请检查出口配置',
                        description: issue.message,
                      });
                      return;
                    }
                    void runAction(async () => {
                      if (outbound) setPreview(await previewOutbound(outbound, payload, session));
                      else await commitSave();
                    });
                  }}
                >
                  <fieldset disabled={formDisabled} className="min-w-0 space-y-5">
                    <legend className="sr-only">出口配置参数</legend>

                    <section
                      aria-label="基础信息与协议"
                      className="overflow-hidden rounded-(--radius-surface) border-[1px] border-border bg-surface"
                    >
                      <div className="border-b-[1px] border-border-subtle px-4 py-3 @xl:px-5">
                        <h3 className="text-(length:--text-sm) font-medium text-foreground">
                          基础信息与协议
                        </h3>
                      </div>
                      <div className="space-y-4 p-4 @xl:p-5">
                        <Input
                          {...fieldProps('name')}
                          label="出口名称"
                          value={config.name}
                          placeholder="例如 jp-residential-vless"
                          onChange={(event) => patch({ name: event.target.value })}
                        />

                        <div className={choiceRowClass}>
                          <div className="min-w-0 @xl:flex-1">
                            <p className="text-(length:--text-sm) font-medium text-foreground">
                              出口协议
                            </p>
                            <p className="mt-1 text-(length:--text-xs) text-text-secondary">
                              供节点 sing-box 分流规则引用。
                            </p>
                          </div>
                          <Select
                            hideLabel
                            label="出口协议"
                            value={config.type}
                            options={[
                              { value: 'vless', label: 'VLESS TCP' },
                              { value: 'socks', label: 'SOCKS5' },
                              { value: 'http', label: 'HTTP CONNECT' },
                              { value: 'shadowsocks', label: 'Shadowsocks' },
                            ]}
                            onValueChange={(value) => {
                              setPreview(null);
                              setInvalidField(null);
                              setConfig(
                                value === 'vless'
                                  ? normalizeConfig({ ...newOutbound(), name: config.name })
                                  : normalizeConfig({
                                      id: config.id,
                                      name: config.name,
                                      type: value as OutboundConfig['type'],
                                      method: value === 'shadowsocks' ? 'aes-128-gcm' : undefined,
                                      server: config.server,
                                      server_port:
                                        value === 'shadowsocks'
                                          ? 8388
                                          : value === 'socks'
                                            ? 1080
                                            : 8080,
                                      username: '',
                                      password: '',
                                      tls: false,
                                    }),
                              );
                            }}
                          />
                        </div>

                        <div className="grid grid-cols-1 gap-4 @xl:grid-cols-[minmax(0,1fr)_9.5rem]">
                          <Input
                            {...fieldProps('server')}
                            label="服务器地址"
                            value={config.server}
                            placeholder="域名或 IP 地址"
                            className="font-mono"
                            onChange={(event) => patch({ server: event.target.value })}
                          />
                          <Input
                            {...fieldProps('server_port')}
                            label="服务器端口"
                            inputMode="numeric"
                            value={config.server_port}
                            className="font-mono tabular-nums"
                            onChange={(event) => patch({ server_port: event.target.value })}
                          />
                        </div>
                      </div>
                    </section>

                    <section
                      aria-label="认证与传输安全"
                      className="overflow-hidden rounded-(--radius-surface) border-[1px] border-border bg-surface"
                    >
                      <div className="border-b-[1px] border-border-subtle px-4 py-3 @xl:px-5">
                        <h3 className="text-(length:--text-sm) font-medium text-foreground">
                          认证与传输安全
                        </h3>
                      </div>
                      <div className="space-y-4 p-4 @xl:p-5">
                        {config.type === 'vless' ? (
                          <>
                            <PasswordField
                              {...fieldProps('uuid')}
                              label="UUID"
                              value={config.uuid ?? ''}
                              onChange={(event) => patch({ uuid: event.target.value })}
                              autoComplete="off"
                              placeholder={
                                savedCredentials?.has_uuid ? '已保存，留空保持原值' : undefined
                              }
                              description={
                                savedCredentials?.has_uuid
                                  ? '已加密保存原 UUID，保持留空将沿用原值。'
                                  : undefined
                              }
                              messages={{ showPassword: '显示 UUID', hidePassword: '隐藏 UUID' }}
                            />

                            <div className={choiceRowClass}>
                              <div className="min-w-0 @xl:flex-1">
                                <p className="text-(length:--text-sm) font-medium text-foreground">
                                  连接安全
                                </p>
                                <p className="mt-1 text-(length:--text-xs) text-text-secondary">
                                  无 TLS 模式仅使用服务器、端口与 UUID。
                                </p>
                              </div>
                              <SegmentedControl
                                label="连接安全"
                                value={config.tls ? 'reality' : 'none'}
                                options={[
                                  { value: 'reality', label: 'REALITY' },
                                  { value: 'none', label: '无 TLS' },
                                ]}
                                onValueChange={(next) =>
                                  patch({
                                    tls: next === 'reality',
                                    server_name: '',
                                    public_key: '',
                                    short_id: '',
                                    flow: next === 'reality' ? 'xtls-rprx-vision' : '',
                                    fingerprint: next === 'reality' ? 'chrome' : '',
                                  })
                                }
                              />
                            </div>

                            {config.tls && (
                              <div className="grid grid-cols-1 gap-4 pt-1 @xl:grid-cols-2">
                                <Input
                                  {...fieldProps('server_name')}
                                  label="SNI"
                                  value={config.server_name ?? ''}
                                  className="font-mono"
                                  onChange={(event) => patch({ server_name: event.target.value })}
                                />
                                <Input
                                  {...fieldProps('short_id')}
                                  label="Short ID（可选）"
                                  value={config.short_id ?? ''}
                                  className="font-mono"
                                  onChange={(event) => patch({ short_id: event.target.value })}
                                />
                                <div className="@xl:col-span-2">
                                  <Input
                                    {...fieldProps('public_key')}
                                    label="REALITY 公钥"
                                    value={config.public_key ?? ''}
                                    className="font-mono"
                                    onChange={(event) => patch({ public_key: event.target.value })}
                                  />
                                </div>
                                <Select
                                  label="Flow"
                                  value={config.flow || 'none'}
                                  options={[
                                    { value: 'xtls-rprx-vision', label: 'Vision' },
                                    { value: 'none', label: '不启用 Flow' },
                                  ]}
                                  onValueChange={(value) =>
                                    patch({ flow: value === 'none' ? '' : value })
                                  }
                                />
                                <ClientFingerprintSelect
                                  value={config.fingerprint || 'chrome'}
                                  onValueChange={(fingerprint) => patch({ fingerprint })}
                                />
                              </div>
                            )}
                          </>
                        ) : config.type === 'shadowsocks' ? (
                          <>
                            <Select
                              label="加密方式"
                              value={config.method}
                              options={shadowsocksMethods.map((method) => ({
                                label: method,
                                value: method,
                              }))}
                              onValueChange={(method) => patch({ method, password: '' })}
                            />
                            <PasswordField
                              {...fieldProps('password')}
                              label={config.method?.startsWith('2022-') ? '预共享密钥' : '密码'}
                              value={config.password ?? ''}
                              autoComplete="new-password"
                              placeholder={
                                savedCredentials?.has_password &&
                                savedCredentials.config.method === config.method
                                  ? '已保存，留空保留原值'
                                  : undefined
                              }
                              onChange={(event) => patch({ password: event.target.value })}
                              messages={{ showPassword: '显示凭证', hidePassword: '隐藏凭证' }}
                            />
                          </>
                        ) : (
                          <>
                            <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
                              <Input
                                {...fieldProps('username')}
                                label="用户名（无认证留空）"
                                value={config.username ?? ''}
                                onChange={(event) => patch({ username: event.target.value })}
                              />
                              <PasswordField
                                {...fieldProps('password')}
                                label="密码"
                                autoComplete="new-password"
                                value={config.password ?? ''}
                                placeholder={
                                  savedCredentials?.has_password
                                    ? '已保存，留空保留原值'
                                    : undefined
                                }
                                onChange={(event) => patch({ password: event.target.value })}
                                messages={{ showPassword: '显示密码', hidePassword: '隐藏密码' }}
                              />
                            </div>
                            {savedCredentials?.has_password && (
                              <p className="text-(length:--text-xs) text-text-secondary">
                                用户名非空且密码留空时保留原密码；清空用户名将移除认证信息。
                              </p>
                            )}
                            {config.type === 'http' && (
                              <>
                                <div className={choiceRowClass}>
                                  <div className="min-w-0 @xl:flex-1">
                                    <p className="text-(length:--text-sm) font-medium text-foreground">
                                      连接安全
                                    </p>
                                    <p className="mt-1 text-(length:--text-xs) text-text-secondary">
                                      启用 TLS 时严格验证服务端证书。
                                    </p>
                                  </div>
                                  <SegmentedControl
                                    label="HTTP 连接安全"
                                    value={config.tls ? 'tls' : 'plain'}
                                    options={[
                                      { value: 'tls', label: 'TLS 验证证书' },
                                      { value: 'plain', label: '明文 HTTP' },
                                    ]}
                                    onValueChange={(next) =>
                                      patch({ tls: next === 'tls', server_name: '' })
                                    }
                                  />
                                </div>
                                {config.tls && (
                                  <Input
                                    {...fieldProps('server_name')}
                                    label="TLS 服务器名称（可选）"
                                    value={config.server_name ?? ''}
                                    className="font-mono"
                                    onChange={(event) => patch({ server_name: event.target.value })}
                                  />
                                )}
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </section>
                  </fieldset>
                </form>
              </>
            )}
          </div>

          <aside
            className="min-w-0 space-y-4 self-start xl:sticky xl:top-4"
            aria-label="出口能力约束与安全策略"
          >
            <section className="overflow-hidden rounded-(--radius-surface) border-[1px] border-border bg-surface">
              <div className="border-b-[1px] border-border-subtle px-5 py-3.5">
                <h3 className="text-(length:--text-sm) font-medium text-foreground">
                  分流能力约束
                </h3>
              </div>
              <dl className="divide-y-[1px] divide-border-subtle text-(length:--text-xs)">
                <div className="flex items-center justify-between gap-3 px-5 py-3">
                  <dt className="text-text-secondary">适用引擎</dt>
                  <dd className="font-medium text-foreground">sing-box</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-5 py-3">
                  <dt className="text-text-secondary">默认出口</dt>
                  <dd
                    className={`font-medium ${
                      config.type === 'http' ? 'text-warning' : 'text-success'
                    }`}
                  >
                    {config.type === 'http' ? '不可设为默认出口' : '允许设为默认出口'}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-5 py-3">
                  <dt className="text-text-secondary">适用协议</dt>
                  <dd className="text-foreground">
                    {config.type === 'http' ? '仅显式 TCP 规则' : 'TCP 与 UDP 规则'}
                  </dd>
                </div>
              </dl>
            </section>

            <section className="space-y-2.5 rounded-(--radius-surface) border-[1px] border-border bg-surface p-5 text-(length:--text-xs) leading-relaxed text-text-secondary">
              <h3 className="text-(length:--text-sm) font-medium text-foreground">
                引用与安全策略
              </h3>
              <p>敏感凭证使用独立密钥静态加密保存，普通读取接口不返回明文。</p>
              <p>控制平面不执行出口连通性探测，代理失效时不会自动降级直连。</p>
              {outbound && (
                <p className="text-foreground tabular-nums">
                  当前版本 v{outbound.version}，已被 {outbound.references} 个节点引用。
                </p>
              )}
            </section>
          </aside>
        </div>
      )}

      {preview && (
        <OutboundImpactDialog
          config={payload}
          preview={preview}
          busy={busy}
          onClose={() => setPreview(null)}
          onConfirm={() => runAction(() => commitSave(preview.confirmation))}
          returnFocus={() => saveButton.current?.focus()}
        />
      )}
    </ProxyWorkbench>
  );
}
