import { ArrowDown, ArrowUp, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import {
  createSubscription,
  listSubscriptionCandidates,
  type ServiceRef,
  type SubscriptionIssued,
  type SubscriptionItem,
  type SubscriptionRule,
  type SubscriptionService,
  type SubscriptionTemplate,
  updateSubscription,
} from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import EditorWorkspace from './EditorWorkspace';
import SubscriptionServicePicker from './SubscriptionServicePicker';

const refKey = (item: ServiceRef) => `${item.node_id}:${item.engine_id}:${item.service_id}`;
const label = (item: SubscriptionService) =>
  [item.node_name || item.node_id, item.service_name || item.service_id].join(' / ');
const unavailableReasons: Record<string, string> = {
  service_removed: '服务已删除，请移除或重新选择',
  permission_lost: '节点导出权限已失效',
  restore_verification_required: '等待恢复核对',
  restore_endpoint_confirmation_required: '等待确认公网入口',
  service_unavailable: '服务停用或公网入口不可用',
};

export default function SubscriptionEditor({
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
  session: Session;
  onClose: () => void;
  onSaved: () => void;
  onIssued: (issued: SubscriptionIssued) => void;
}) {
  const form = useId();
  const { toast } = useToastStack();
  const [name, setName] = useState(item?.name ?? '');
  const [port, setPort] = useState(String(item?.mihomo_port ?? 7890));
  const [ruleIDs, setRuleIDs] = useState<string[]>(
    item?.rule_ids ?? rules.filter((rule) => rule.enabled).map((rule) => rule.id),
  );
  const [selected, setSelected] = useState<SubscriptionService[]>(item?.services ?? []);
  const [reselected, setReselected] = useState<ServiceRef[]>([]);
  const [candidates, setCandidates] = useState<SubscriptionService[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    try {
      const items: SubscriptionService[] = [];
      let after = '';
      do {
        const page = await listSubscriptionCandidates(after, controller.signal);
        if (controller.signal.aborted) return;
        items.push(...page.items);
        after = page.next_cursor;
      } while (after);
      if (controller.signal.aborted) return;
      setCandidates(items);
      setSelected((previous) =>
        previous.map((service) =>
          service.status === 'invalid'
            ? service
            : (items.find((candidate) => refKey(candidate) === refKey(service)) ?? service),
        ),
      );
      setLoaded(true);
    } catch (error) {
      if (!controller.signal.aborted)
        toast({
          id: 'subscription-candidates',
          type: 'error',
          title: '未能读取可选服务',
          description: error instanceof Error ? error.message : '请重新读取服务。',
        });
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [toast]);
  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, [load]);

  function toggleServices(services: SubscriptionService[], checked: boolean) {
    const keys = new Set(services.map(refKey));
    const additions = services.filter(
      (service) => !selected.some((old) => refKey(old) === refKey(service)),
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
              (value) => services.find((candidate) => refKey(candidate) === refKey(value)) ?? value,
            ),
            ...additions,
          ]
        : old.filter((value) => !keys.has(refKey(value))),
    );
    setReselected((old) => [
      ...old.filter((value) => !keys.has(refKey(value))),
      ...(checked
        ? services.filter((service) =>
            item?.services.some(
              (value) => refKey(value) === refKey(service) && value.status === 'invalid',
            ),
          )
        : []),
    ]);
    setAnnouncement(
      checked ? `已选择 ${services.length} 个服务` : `已移除 ${services.length} 个服务`,
    );
  }
  function move(index: number, offset: number) {
    setAnnouncement(`${label(selected[index])}，已移至第 ${index + offset + 1} 位`);
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
        title: '请完善订阅',
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
  const initialRules =
    item?.rule_ids ?? rules.filter((rule) => rule.enabled).map((rule) => rule.id);
  const dirty =
    name !== (item?.name ?? '') ||
    port !== String(item?.mihomo_port ?? 7890) ||
    JSON.stringify(ruleIDs) !== JSON.stringify(initialRules) ||
    JSON.stringify(selected.map(refKey)) !== JSON.stringify((item?.services ?? []).map(refKey)) ||
    reselected.length > 0;
  const hasMihomo = rules.some((rule) => ruleIDs.includes(rule.id) && rule.format === 'mihomo');
  return (
    <EditorWorkspace
      title={item ? `编辑订阅：${item.name}` : '创建订阅'}
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
        <fieldset disabled={busy} className="min-w-0 space-y-8">
          <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="max-w-xl">
              <Input
                label="订阅名称"
                placeholder="例如：日常使用"
                value={name}
                maxLength={128}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <p className="text-sm tabular-nums text-(--text-secondary)" role="status">
              已选 {selected.length} / 100 个服务，{ruleIDs.length} 条应用规则
            </p>
          </div>
          <div className="grid gap-6 border-y border-(--border-subtle) py-6 lg:grid-cols-2">
            <SubscriptionServicePicker
              candidates={candidates}
              selected={selected}
              loaded={loaded}
              loading={loading}
              onRetry={() => void load()}
              onToggle={toggleServices}
            />
            <section
              aria-labelledby={`${form}-selected`}
              className="min-w-0 space-y-4 border-t border-(--border-subtle) pt-6 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6"
            >
              <div>
                <h3 id={`${form}-selected`} className="text-sm font-medium">
                  已选服务与顺序
                </h3>
                <p className="mt-1 text-xs text-(--text-secondary)">
                  按列表顺序导出，首个可用服务为默认节点。
                </p>
              </div>
              <p className="sr-only" role="status">
                {announcement}
              </p>
              {selected.length === 0 && (
                <p className="py-12 text-center text-sm text-(--text-secondary)">
                  从可选服务中勾选要加入订阅的节点。
                </p>
              )}
              <ol className="max-h-[38rem] divide-y divide-(--border-subtle) overflow-y-auto pr-1">
                {selected.map((service, index) => {
                  const replacement =
                    service.status === 'invalid'
                      ? candidates.find(
                          (candidate) =>
                            refKey(candidate) === refKey(service) &&
                            candidate.status === 'available',
                        )
                      : undefined;
                  return (
                    <li key={refKey(service)} className="flex flex-wrap items-center gap-3 py-3">
                      <span
                        className="w-5 shrink-0 text-xs tabular-nums text-(--text-secondary)"
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1 basis-32">
                        <p className="break-all text-sm font-medium">
                          {service.service_name || service.service_id}
                        </p>
                        <p className="break-all text-xs text-(--text-secondary)">
                          {service.node_name || service.node_id} / {service.engine}
                        </p>
                        {service.status !== 'available' && (
                          <p className="mt-1 text-xs text-(--danger)">
                            {unavailableReasons[service.reason] ?? '服务不可用'}
                          </p>
                        )}
                        {service.incompatible_formats.length > 0 && (
                          <p className="mt-1 text-xs text-(--text-secondary)">
                            {service.incompatible_formats.join('、')} 不兼容 Xray REALITY
                          </p>
                        )}
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        {replacement && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => toggleServices([replacement], true)}
                          >
                            <RefreshCw size={16} aria-hidden="true" />
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
                              aria-label={`上移 ${label(service)}`}
                              onClick={() => move(index, -1)}
                            >
                              <ArrowUp size={16} aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={index === selected.length - 1}
                              aria-label={`下移 ${label(service)}`}
                              onClick={() => move(index, 1)}
                            >
                              <ArrowDown size={16} aria-hidden="true" />
                            </Button>
                          </>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`移除 ${label(service)}`}
                          onClick={() => toggleServices([service], false)}
                        >
                          <X size={16} aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>
          <section aria-labelledby={`${form}-rules`} className="space-y-4">
            <div>
              <h3 id={`${form}-rules`} className="text-base font-medium">
                客户端与配置
              </h3>
              <p className="mt-1 text-sm text-(--text-secondary)">
                客户端请求命中所选规则后，使用对应模板生成配置。
              </p>
            </div>
            <div className="grid gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="min-w-0 border-b border-(--border-subtle) py-3 [overflow-wrap:anywhere]"
                >
                  <Checkbox
                    label={`${rule.name}${!rule.enabled ? '（已停用）' : ''}`}
                    description={`${templates.find((template) => template.id === rule.template_id)?.name ?? rule.format}`}
                    checked={ruleIDs.includes(rule.id)}
                    disabled={!rule.enabled && !ruleIDs.includes(rule.id)}
                    onCheckedChange={(next) =>
                      setRuleIDs((old) =>
                        next === true ? [...old, rule.id] : old.filter((id) => id !== rule.id),
                      )
                    }
                  />
                </div>
              ))}
            </div>
            {!rules.length && (
              <p className="text-sm text-(--text-secondary)">暂无应用规则，请联系管理员添加。</p>
            )}
            {hasMihomo && (
              <div className="max-w-xs pt-2">
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
          </section>
        </fieldset>
      </form>
    </EditorWorkspace>
  );
}
