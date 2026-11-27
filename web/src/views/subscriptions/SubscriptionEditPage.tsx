import { ArrowDown, ArrowUp, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import {
  createSubscription,
  getSubscription,
  listSubscriptionCandidates,
  type ServiceRef,
  type SubscriptionItem,
  type SubscriptionRule,
  type SubscriptionService,
  type SubscriptionTemplate,
  updateSubscription,
} from '@/api/subscriptions';
import { Badge } from '@/components/arc/badge/badge';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import InitialSkeleton from '@/components/initial-skeleton';
import EditorWorkspace from './components/EditorWorkspace';
import SubscriptionServicePicker from './components/SubscriptionServicePicker';
import {
  serviceDisplayLabel,
  serviceRefKey,
  unavailableReasonLabel,
} from './components/service-meta';
import { useSubscriptionPages } from './components/useSubscriptionPages';
import { useSubscriptionsContext } from './context';

export default function SubscriptionEditPage() {
  const { subscriptionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToastStack();
  const {
    session,
    canManage,
    rules,
    rulesLoading,
    templates,
    templatesLoading,
    reloadRules,
    reloadTemplates,
    openIssued,
  } = useSubscriptionsContext();

  const initialFromState = (location.state as { initialSubscription?: SubscriptionItem } | null)
    ?.initialSubscription;
  const [loadedItem, setLoadedItem] = useState<SubscriptionItem | null>(
    subscriptionId && initialFromState?.id === subscriptionId ? initialFromState : null,
  );
  const [loadingItem, setLoadingItem] = useState(
    Boolean(subscriptionId && initialFromState?.id !== subscriptionId),
  );
  const abortRef = useRef<AbortController | null>(null);

  const loadItem = useCallback(async () => {
    if (!subscriptionId) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadingItem(true);
    try {
      const result = await getSubscription(subscriptionId, controller.signal);
      if (!controller.signal.aborted) setLoadedItem(result);
    } catch (error) {
      if (!controller.signal.aborted) {
        toast({
          id: `subscription-load-${subscriptionId}`,
          type: 'error',
          title: '未能读取订阅配置',
          description: error instanceof Error ? error.message : '请重新读取或返回订阅列表。',
        });
      }
    } finally {
      if (!controller.signal.aborted) setLoadingItem(false);
    }
  }, [subscriptionId, toast]);

  useEffect(() => {
    if (subscriptionId && (!loadedItem || loadedItem.id !== subscriptionId)) {
      void loadItem();
    }
    return () => abortRef.current?.abort();
  }, [subscriptionId, loadedItem, loadItem]);

  if (!canManage) return <Navigate to="/subscriptions" replace />;

  const waitingMeta = rules === null || templates === null;
  const waitingItem = Boolean(subscriptionId && !loadedItem);

  if (waitingMeta || waitingItem) {
    const busyLoading = rulesLoading || templatesLoading || loadingItem;
    return (
      <section className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="secondary" size="sm" onClick={() => void navigate('/subscriptions')}>
            返回订阅列表
          </Button>
          {!busyLoading && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (rules === null) void reloadRules();
                if (templates === null) void reloadTemplates();
                if (waitingItem) void loadItem();
              }}
            >
              <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
              重新读取
            </Button>
          )}
        </div>
        {busyLoading ? (
          <InitialSkeleton label="正在读取订阅编辑数据" lines={6} />
        ) : (
          <div className="rounded-(--radius-panel) border-[1px] border-border bg-surface p-8 text-center text-(length:--text-sm) text-text-secondary">
            未能读取订阅编辑所需数据，请点击重新读取或返回列表。
          </div>
        )}
      </section>
    );
  }

  return (
    <SubscriptionEditorForm
      key={loadedItem?.id ?? 'new'}
      item={subscriptionId ? loadedItem : null}
      rules={rules}
      templates={templates}
      onClose={() => void navigate('/subscriptions')}
      onSaved={() => void navigate('/subscriptions')}
      onIssued={(issued) => {
        void navigate('/subscriptions');
        openIssued(issued);
      }}
      session={session}
    />
  );
}

function SubscriptionEditorForm({
  item,
  rules,
  templates,
  session,
  onClose,
  onSaved,
  onIssued,
}: {
  item: SubscriptionItem | null;
  rules: SubscriptionRule[];
  templates: SubscriptionTemplate[];
  session: import('@/api/auth').Session;
  onClose: () => void;
  onSaved: () => void;
  onIssued: (issued: import('@/api/subscriptions').SubscriptionIssued) => void;
}) {
  const form = useId();
  const { toast } = useToastStack();

  const initialRuleIDs = useMemo(
    () => item?.rule_ids ?? rules.filter((rule) => rule.enabled).map((rule) => rule.id),
    [item, rules],
  );
  const [name, setName] = useState(item?.name ?? '');
  const [port, setPort] = useState(String(item?.mihomo_port ?? 7890));
  const [ruleIDs, setRuleIDs] = useState<string[]>(initialRuleIDs);
  const [selected, setSelected] = useState<SubscriptionService[]>(item?.services ?? []);
  const [reselected, setReselected] = useState<ServiceRef[]>([]);
  const [query, setQuery] = useState('');
  const [onlyInvalid, setOnlyInvalid] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [busy, setBusy] = useState(false);

  const search = query.trim();
  const request = useCallback(
    (after: string, signal: AbortSignal) => listSubscriptionCandidates(after, search, signal),
    [search],
  );
  const page = useSubscriptionPages(search, request, 'subscription-candidates', '未能读取可选服务');
  const candidates = page.items ?? [];
  const loaded = page.items !== null;

  function toggleServices(services: SubscriptionService[], checked: boolean) {
    const keys = new Set(services.map(serviceRefKey));
    const additions = services.filter(
      (service) => !selected.some((old) => serviceRefKey(old) === serviceRefKey(service)),
    );
    if (checked && selected.length + additions.length > 100) {
      toast({
        id: 'subscription-service-limit',
        type: 'error',
        title: '每个订阅最多选择 100 个服务',
        description: '请缩小选择范围。',
      });
      return;
    }
    setSelected((old) =>
      checked
        ? [
            ...old.map(
              (value) =>
                services.find((candidate) => serviceRefKey(candidate) === serviceRefKey(value)) ??
                value,
            ),
            ...additions,
          ]
        : old.filter((value) => !keys.has(serviceRefKey(value))),
    );
    setReselected((old) => [
      ...old.filter((value) => !keys.has(serviceRefKey(value))),
      ...(checked
        ? services.filter((service) =>
            item?.services.some(
              (value) =>
                serviceRefKey(value) === serviceRefKey(service) && value.status === 'invalid',
            ),
          )
        : []),
    ]);
    setAnnouncement(
      checked ? `已选择 ${services.length} 个服务` : `已移除 ${services.length} 个服务`,
    );
  }

  function move(index: number, offset: number) {
    setAnnouncement(`${serviceDisplayLabel(selected[index])}，已移至第 ${index + offset + 1} 位`);
    setSelected((old) => {
      const next = [...old];
      const destination = index + offset;
      if (destination < 0 || destination >= next.length) return old;
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  async function submit() {
    if (busy) return;
    const number = Number(port);
    if (
      !name.trim() ||
      !Number.isInteger(number) ||
      number < 1 ||
      number > 65535 ||
      !ruleIDs.length ||
      !selected.length
    ) {
      toast({
        id: 'subscription-edit-validation',
        type: 'error',
        title: '请完善订阅配置',
        description: '填写名称和有效端口，并选择应用规则与服务。',
      });
      return;
    }
    setBusy(true);
    try {
      const input = {
        name: name.trim(),
        mihomo_port: number,
        rule_ids: ruleIDs,
        services: selected.map(({ node_id, engine_id, service_id }) => ({
          node_id,
          engine_id,
          service_id,
        })),
        reselect: reselected.map(({ node_id, engine_id, service_id }) => ({
          node_id,
          engine_id,
          service_id,
        })),
        version: item?.version ?? 0,
      };
      if (item) {
        await updateSubscription(item.id, input, session);
        toast({ type: 'success', title: '订阅已保存' });
        onSaved();
      } else {
        const issued = await createSubscription(input, session);
        onIssued(issued);
      }
    } catch (error) {
      toast({
        id: 'subscription-save',
        type: 'error',
        title: '未能保存订阅',
        description: error instanceof Error ? error.message : '请检查服务状态后重试。',
      });
    } finally {
      setBusy(false);
    }
  }

  const dirty =
    name !== (item?.name ?? '') ||
    port !== String(item?.mihomo_port ?? 7890) ||
    JSON.stringify(ruleIDs) !== JSON.stringify(initialRuleIDs) ||
    JSON.stringify(selected.map(serviceRefKey)) !==
      JSON.stringify((item?.services ?? []).map(serviceRefKey)) ||
    reselected.length > 0;

  const hasMihomo = rules.some((rule) => ruleIDs.includes(rule.id) && rule.format === 'mihomo');
  const invalidCount = selected.filter((service) => service.status !== 'available').length;
  const visibleSelected =
    onlyInvalid && invalidCount > 0
      ? selected.filter((service) => service.status !== 'available')
      : selected;
  const firstAvailable = selected.find((service) => service.status === 'available');
  const firstAvailableKey = firstAvailable ? serviceRefKey(firstAvailable) : null;

  return (
    <EditorWorkspace
      breadcrumb={item ? `编辑订阅 / ${item.name}` : '创建订阅'}
      title={item ? `编辑订阅：${item.name}` : '创建订阅'}
      backLabel="订阅列表"
      meta={
        <>
          <Badge tone="neutral" size="sm" className="tabular-nums">
            已选 {selected.length} / 100 服务
          </Badge>
          {dirty && (
            <Badge tone="warning" size="sm">
              未保存更改
            </Badge>
          )}
        </>
      }
      form={form}
      saveLabel={item ? '保存订阅' : '创建并获取链接'}
      busy={busy}
      disabled={!loaded || !rules.some((rule) => ruleIDs.includes(rule.id) && rule.enabled)}
      dirty={dirty}
      onClose={onClose}
    >
      <form
        id={form}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={busy} className="min-w-0 space-y-6">
          {/* Top Compact Config Grid: Basic Info + Client Rules */}
          <div className="grid gap-6 rounded-(--radius-panel) border-[1px] border-border bg-surface p-5 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-5">
              <Input
                label="订阅名称"
                placeholder="例如：主力多端配置"
                value={name}
                maxLength={128}
                required
                onChange={(event) => setName(event.target.value)}
              />
              {hasMihomo && (
                <div className="max-w-56">
                  <Input
                    label="Mihomo 本机端口"
                    type="number"
                    min={1}
                    max={65535}
                    required
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                  />
                </div>
              )}
            </div>

            <section
              aria-labelledby={`${form}-rules`}
              className="min-w-0 space-y-3 border-t-[1px] border-border-subtle pt-5 lg:col-span-7 lg:border-t-0 lg:border-l-[1px] lg:pt-0 lg:pl-6"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 id={`${form}-rules`} className="text-(length:--text-sm) font-medium">
                  分发规则
                </h3>
                <span className="text-(length:--text-xs) tabular-nums text-text-secondary">
                  已选 {ruleIDs.length} 条
                </span>
              </div>
              {rules.length === 0 ? (
                <p className="text-(length:--text-sm) text-text-secondary">
                  暂无应用规则，请联系管理员添加。
                </p>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {rules.map((rule) => {
                    const checked = ruleIDs.includes(rule.id);
                    return (
                      <div
                        key={rule.id}
                        className={`min-w-0 rounded-(--radius-control) border-[1px] px-3 py-2.5 [overflow-wrap:anywhere] ${
                          checked
                            ? 'border-(--table-row-selected-border) bg-(--table-row-selected)'
                            : 'border-border-subtle bg-surface-raised'
                        }`}
                      >
                        <Checkbox
                          label={`${rule.name}${!rule.enabled ? '（已停用）' : ''}`}
                          description={
                            templates.find((template) => template.id === rule.template_id)?.name ??
                            rule.format
                          }
                          checked={checked}
                          disabled={!rule.enabled && !checked}
                          onCheckedChange={(next) =>
                            setRuleIDs((old) =>
                              next === true
                                ? [...old, rule.id]
                                : old.filter((id) => id !== rule.id),
                            )
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>

          {/* Full-width Dual-Pane Service Transfer Workbench */}
          <div className="grid divide-y divide-border-subtle rounded-(--radius-panel) border-[1px] border-border bg-surface lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <div className="min-w-0 p-5">
              <SubscriptionServicePicker
                candidates={candidates}
                selected={selected}
                loaded={loaded}
                query={query}
                onQuery={setQuery}
                more={Boolean(page.cursor)}
                onMore={() => void page.load(page.cursor)}
                loading={page.loading}
                onRetry={() => void page.load()}
                onToggle={toggleServices}
              />
            </div>

            <section aria-labelledby={`${form}-selected`} className="min-w-0 space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 id={`${form}-selected`} className="text-(length:--text-sm) font-medium">
                    已选导出队列
                  </h3>
                  <p className="mt-1 text-(length:--text-xs) text-text-secondary">
                    按当前顺序导出，首个可用服务作为默认节点。
                  </p>
                </div>
                {invalidCount > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant={onlyInvalid ? 'primary' : 'secondary'}
                    onClick={() => setOnlyInvalid((prev) => !prev)}
                  >
                    仅看异常 ({invalidCount})
                  </Button>
                )}
              </div>
              <p className="sr-only" role="status">
                {announcement}
              </p>
              {visibleSelected.length === 0 ? (
                <p className="py-14 text-center text-(length:--text-sm) text-text-secondary">
                  从左侧勾选要加入订阅的服务。
                </p>
              ) : (
                <ol className="max-h-[38rem] divide-y divide-border-subtle overflow-y-auto pr-1">
                  {visibleSelected.map((service) => {
                    const key = serviceRefKey(service);
                    const index = selected.findIndex((itemRow) => serviceRefKey(itemRow) === key);
                    const isDefault = key === firstAvailableKey;
                    const replacement =
                      service.status === 'invalid'
                        ? candidates.find(
                            (candidate) =>
                              serviceRefKey(candidate) === key && candidate.status === 'available',
                          )
                        : undefined;
                    return (
                      <li key={key} className="flex flex-wrap items-center gap-3 py-3">
                        <span
                          className="w-5 shrink-0 text-(length:--text-xs) tabular-nums text-text-secondary"
                          aria-hidden="true"
                        >
                          {index + 1}
                        </span>
                        <div className="min-w-0 flex-1 basis-36 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="break-all text-(length:--text-sm) font-medium">
                              {service.service_name || service.service_id}
                            </span>
                            {isDefault && (
                              <Badge tone="info" size="sm">
                                默认节点
                              </Badge>
                            )}
                          </div>
                          <p className="break-all text-(length:--text-xs) text-text-secondary">
                            {service.node_name || service.node_id} / {service.engine}
                          </p>
                          {service.status !== 'available' && (
                            <p className="text-(length:--text-xs) text-(--danger)">
                              {unavailableReasonLabel(service.reason)}
                            </p>
                          )}
                          {service.incompatible_formats.length > 0 && (
                            <p className="text-(length:--text-xs) text-(--warning)">
                              {service.incompatible_formats.join('、')} 不兼容 Xray REALITY
                            </p>
                          )}
                        </div>
                        <div className="ml-auto flex items-center gap-1.5">
                          {replacement && (
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              onClick={() => toggleServices([replacement], true)}
                            >
                              <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" />
                              重新选择
                            </Button>
                          )}
                          {selected.length > 1 && (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={index === 0}
                                aria-label={`上移 ${serviceDisplayLabel(service)}`}
                                onClick={() => move(index, -1)}
                              >
                                <ArrowUp size={15} strokeWidth={1.75} aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={index === selected.length - 1}
                                aria-label={`下移 ${serviceDisplayLabel(service)}`}
                                onClick={() => move(index, 1)}
                              >
                                <ArrowDown size={15} strokeWidth={1.75} aria-hidden="true" />
                              </Button>
                            </>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`移除 ${serviceDisplayLabel(service)}`}
                            onClick={() => toggleServices([service], false)}
                          >
                            <X size={15} strokeWidth={1.75} aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        </fieldset>
      </form>
    </EditorWorkspace>
  );
}
