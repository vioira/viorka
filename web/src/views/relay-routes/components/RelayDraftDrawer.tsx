import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useId, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Session } from '@/api/auth';
import { ApiError } from '@/api/client';
import { type RelayRoute, saveRelay } from '@/api/relays';
import { Button } from '@/components/arc/button/button';
import { Drawer, DrawerContent } from '@/components/arc/drawer/drawer';
import { Input } from '@/components/arc/input/input';
import { Select } from '@/components/arc/select/select';
import { Switch } from '@/components/arc/switch/switch';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import RelayChainStrip from '@/components/proxy/RelayChainStrip';
import { endpointText } from '@/components/proxy/relay-meta';
import RelayLandingPicker from './RelayLandingPicker';
import { useRelayDraftSources } from './use-relay-draft-sources';

export default function RelayDraftDrawer({
  engine,
  service,
  initialEntry,
  route,
  onClose,
  onSaved,
  returnFocus,
}: {
  initialEntry: string;
  engine: string;
  service: string;
  route?: RelayRoute;
  onClose: () => void;
  returnFocus: () => void;
  onSaved: (route: RelayRoute, review: boolean) => void;
}) {
  const session = useOutletContext<Session>();
  const { toast } = useToastStack();
  const formId = useId();
  const draft = route?.draft;

  const [name, setName] = useState(draft?.name ?? '');
  const [nameTouched, setNameTouched] = useState(Boolean(draft?.name));
  const [source, setSource] = useState({ engine, service });
  const [entry, setEntry] = useState(draft?.engine_id ?? initialEntry);
  const [host, setHost] = useState<string | null>(draft?.public.host ?? null);
  const [port, setPort] = useState(String(draft?.public.port ?? 10080));
  const [customListen, setCustomListen] = useState(
    Boolean(
      draft &&
        (draft.listen.port !== draft.public.port ||
          (draft.listen.host !== '0.0.0.0' && draft.listen.host !== '::')),
    ),
  );
  const [listenHost, setListenHost] = useState<string | null>(draft?.listen.host ?? null);
  const [listenPort, setListenPort] = useState<string | null>(
    draft && draft.listen.port !== draft.public.port ? String(draft.listen.port) : null,
  );
  const [version, setVersion] = useState(draft?.version ?? 0);
  const [saving, setSaving] = useState(false);

  const routeId = route?.id;
  const { entries, landing, latest, loading, needsRetry, reload } = useRelayDraftSources(
    routeId,
    source.engine,
    source.service,
  );

  const conflict =
    latest && (latest.cleanup_only || latest.draft.version !== version) ? latest : null;
  const selected = entry
    ? entries?.find((v) => v.id === entry)
    : entries?.length === 1
      ? entries[0]
      : undefined;
  const publicHost = host ?? selected?.public_host ?? '';
  const defaultListenHost = selected?.public_host.includes(':') ? '::' : '0.0.0.0';
  const effectiveListenHost = customListen ? (listenHost ?? defaultListenHost) : defaultListenHost;
  const effectiveListenPort = customListen ? listenPort || port : port;
  const currentLanding =
    landing?.landing_engine_id === source.engine && landing.landing_service_id === source.service
      ? landing
      : null;

  const suggestedName =
    selected && currentLanding ? `${selected.name} 至 ${currentLanding.landing_name}` : '';
  const effectiveName = nameTouched ? name : name || suggestedName;

  async function save(review: boolean) {
    if (!selected || !currentLanding || saving || loading || needsRetry || conflict) return;
    const trimmedName = effectiveName.trim();
    const numericPort = Number(port);
    const numericListenPort = Number(effectiveListenPort);
    if (
      !trimmedName ||
      !publicHost.trim() ||
      !effectiveListenHost.trim() ||
      numericPort < 1 ||
      numericPort > 65535 ||
      numericListenPort < 1 ||
      numericListenPort > 65535
    ) {
      toast({
        id: 'relay-validation',
        type: 'error',
        title: '请补全线路参数',
        description: '线路名称、公网地址、监听地址与 1 至 65535 端口均为必填项。',
      });
      return;
    }
    setSaving(true);
    try {
      const result = await saveRelay(
        routeId,
        {
          name: trimmedName,
          engine_id: selected.id,
          landing_engine_id: source.engine,
          landing_service_id: source.service,
          version,
          landing_revision: currentLanding.landing_revision,
          public: { host: publicHost.trim(), port: numericPort },
          listen: { host: effectiveListenHost.trim(), port: numericListenPort },
        },
        session,
      );
      toast({ type: 'success', title: '已保存线路草稿' });
      onSaved(result, review);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) void reload();
      toast({
        id: 'relay-save',
        type: 'error',
        title: '未能保存线路',
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  const disabled =
    saving || loading || needsRetry || !selected || !currentLanding || Boolean(conflict);

  return (
    <Drawer
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DrawerContent
        title={route ? '编辑中转线路' : '创建中转线路'}
        description={route ? `草稿 v${version}` : '配置入口 Realm 与落地代理服务的转发链路'}
        className="[--drawer-size:min(38rem,calc(100vw-var(--space-4)))]"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus();
        }}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="submit"
              form={formId}
              name="intent"
              value="draft"
              variant="secondary"
              disabled={disabled}
            >
              仅保存草稿
            </Button>
            <Button
              type="submit"
              form={formId}
              name="intent"
              value="review"
              disabled={disabled}
              loading={saving}
            >
              保存并审查发布
            </Button>
          </div>
        }
      >
        <form
          id={formId}
          className="grid min-w-0 gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            const button = (e.nativeEvent as SubmitEvent).submitter;
            void save(!(button instanceof HTMLButtonElement && button.value === 'draft'));
          }}
        >
          {/* Live 3-Hop Path Preview */}
          <section aria-label="转发链路预览" className="min-w-0 space-y-2">
            <h3 className="text-(length:--text-xs) font-medium text-text-secondary">
              转发链路预览
            </h3>
            <RelayChainStrip
              compact
              entryName={selected?.name ?? (route?.entry_name || '待选择入口')}
              publicEndpoint={{ host: publicHost.trim(), port: Number(port) || 0 }}
              listenEndpoint={{
                host: effectiveListenHost.trim(),
                port: Number(effectiveListenPort) || 0,
              }}
              dialEndpoint={currentLanding?.dial}
              landingName={
                currentLanding?.landing_name ||
                (source.service === service ? draft?.landing_name : '') ||
                '待选择落地'
              }
              landingRevision={currentLanding?.landing_revision}
            />
          </section>

          {conflict && (
            <section
              aria-label="草稿版本冲突"
              className="space-y-2.5 rounded-(--radius-control) border-[1px] border-warning/40 bg-surface-muted p-3.5 text-(length:--text-sm)"
            >
              <div className="flex items-center gap-2 font-medium text-warning">
                <AlertTriangle size={16} strokeWidth={1.75} aria-hidden="true" />
                <span>{conflict.cleanup_only ? '落地导出权限已失效' : '线路已有更新的草稿'}</span>
              </div>
              {!conflict.cleanup_only && (
                <>
                  <p className="text-(length:--text-xs) text-text-secondary wrap-anywhere">
                    最新草稿 v{conflict.draft.version}：{conflict.draft.name}，入口{' '}
                    {endpointText(conflict.draft.public)}，落地 {conflict.draft.landing_name}（
                    {endpointText(conflict.draft.dial)}）
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setVersion(conflict.draft.version)}
                  >
                    保留当前输入并基于 v{conflict.draft.version} 编辑
                  </Button>
                </>
              )}
            </section>
          )}

          {/* Section 1: Entry Realm & Public Endpoint */}
          <section
            aria-label="入口与公网映射"
            className="grid min-w-0 gap-4 border-t-[1px] border-border-subtle pt-5"
          >
            <h3 className="text-(length:--text-sm) font-medium text-foreground">入口与公网映射</h3>
            <Select
              label="入口 Realm 节点"
              value={selected?.id ?? ''}
              disabled={Boolean(route) || !entries?.length}
              options={(entries ?? []).map((e) => ({
                value: e.id,
                label: e.public_host ? `${e.name} (${e.public_host})` : e.name,
              }))}
              placeholder={entries ? '选择已安装托管 Realm 的节点' : '正在读取入口节点…'}
              description={
                entries?.length === 0
                  ? '暂无可用入口，请先在有管理权限的节点安装托管 Realm。'
                  : entries && entry && !selected
                    ? route
                      ? '当前入口节点已不可管理。'
                      : '预选入口已不可用，请选择其他入口节点。'
                    : undefined
              }
              onValueChange={(id) => {
                setEntry(id);
                setHost(null);
              }}
            />
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)]">
              <Input
                label="公网 IP 或域名"
                required
                value={publicHost}
                onChange={(e) => setHost(e.target.value)}
              />
              <Input
                label="公网端口"
                type="number"
                required
                min={1}
                max={65535}
                className="tabular-nums"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>

            <div className="space-y-3 rounded-(--radius-control) border-[1px] border-border bg-background p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-(length:--text-xs) font-medium text-foreground">
                    自定义本机监听与 NAT 映射
                  </p>
                  <p className="mt-0.5 text-(length:--text-xs) text-text-secondary">
                    {customListen
                      ? '公网与内网端口不同时分别指定本机监听地址和端口'
                      : `默认本机监听 ${defaultListenHost}:${port || '10080'}`}
                  </p>
                </div>
                <Switch
                  aria-label="自定义本机监听与 NAT 映射"
                  checked={customListen}
                  onCheckedChange={(checked) => {
                    setCustomListen(checked);
                    if (!checked) {
                      setListenHost(null);
                      setListenPort(null);
                    }
                  }}
                />
              </div>

              {customListen && (
                <div className="grid gap-4 border-t-[1px] border-border-subtle pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.65fr)]">
                  <Input
                    label="监听 IP"
                    required
                    value={effectiveListenHost}
                    onChange={(e) => setListenHost(e.target.value)}
                  />
                  <Input
                    label="监听端口"
                    type="number"
                    min={1}
                    max={65535}
                    className="tabular-nums"
                    placeholder={port}
                    value={listenPort ?? ''}
                    onChange={(e) => setListenPort(e.target.value || null)}
                    description="留空时跟随公网端口"
                  />
                </div>
              )}
            </div>
          </section>

          {/* Section 2: Landing Proxy Service */}
          <section
            aria-label="落地代理服务"
            className="grid min-w-0 gap-3 border-t-[1px] border-border-subtle pt-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-(length:--text-sm) font-medium text-foreground">落地代理服务</h3>
              {currentLanding && (
                <span className="font-mono text-(length:--text-xs) text-text-secondary tabular-nums">
                  落地修订 r{currentLanding.landing_revision}
                </span>
              )}
            </div>
            <RelayLandingPicker
              engine={source.engine}
              service={source.service}
              label={
                currentLanding?.landing_name ||
                (source.service === service && draft?.landing_name) ||
                source.service
              }
              onChange={(nextEngine, nextService) =>
                setSource({ engine: nextEngine, service: nextService })
              }
            />
            {currentLanding && (
              <dl className="grid grid-cols-2 gap-3 rounded-(--radius-control) border-[1px] border-border bg-background px-3.5 py-2.5 text-(length:--text-xs)">
                <div className="min-w-0">
                  <dt className="text-text-secondary">Realm 拨号目标</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-foreground wrap-anywhere">
                    {endpointText(currentLanding.dial)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-text-secondary">落地本机监听</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-foreground wrap-anywhere">
                    {endpointText(currentLanding.landing_listen)}
                  </dd>
                </div>
              </dl>
            )}
          </section>

          {/* Section 3: Route Name */}
          <section
            aria-label="线路标识"
            className="grid min-w-0 gap-3 border-t-[1px] border-border-subtle pt-5"
          >
            <Input
              label="线路名称"
              required
              maxLength={128}
              placeholder={suggestedName || '例如：香港入口 至 日本落地'}
              value={effectiveName}
              onChange={(e) => {
                setNameTouched(true);
                setName(e.target.value);
              }}
            />
          </section>

          {needsRetry && (
            <Button type="button" variant="secondary" onClick={() => void reload()}>
              <RefreshCw size={15} strokeWidth={1.75} aria-hidden="true" />
              重新读取配置
            </Button>
          )}
        </form>
      </DrawerContent>
    </Drawer>
  );
}
