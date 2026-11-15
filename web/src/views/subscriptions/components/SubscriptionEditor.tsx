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
  updateSubscription,
} from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { Skeleton } from '@/components/arc/skeleton/skeleton';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import { useDialogFocus } from './useDialogFocus';

const refKey = (item: ServiceRef) => `${item.node_id}:${item.engine_id}:${item.service_id}`;
const label = (item: SubscriptionService) =>
  [item.node_name || item.node_id, item.service_name || item.service_id].join(' / ');
const unavailableReasons: Record<string, string> = {
  service_removed: '服务已删除，可在下方重新选择',
  permission_lost: '节点导出权限已失效',
  restore_verification_required: '等待恢复核对',
  restore_endpoint_confirmation_required: '等待确认公网入口',
  service_unavailable: '服务停用或公网入口不可用',
};

export default function SubscriptionEditor({
  item,
  rules,
  session,
  onClose,
  onSaved,
  onIssued,
}: {
  item: SubscriptionItem | null;
  rules: SubscriptionRule[];
  session: Session;
  onClose: () => void;
  onSaved: () => void;
  onIssued: (issued: SubscriptionIssued) => void;
}) {
  const form = useId();
  const { toast } = useToastStack();
  const [name, setName] = useState(item?.name ?? '');
  const [port, setPort] = useState(String(item?.mihomo_port ?? 7890));
  const [ruleIDs, setRuleIDs] = useState<string[]>(item?.rule_ids ?? []);
  const [selected, setSelected] = useState<SubscriptionService[]>(item?.services ?? []);
  const [reselected, setReselected] = useState<ServiceRef[]>([]);
  const [candidates, setCandidates] = useState<SubscriptionService[]>([]);
  const [cursor, setCursor] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const dialogFocus = useDialogFocus();

  const load = useCallback(
    async (after = '') => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setLoading(true);
      try {
        const page = await listSubscriptionCandidates(after, controller.signal);
        if (controller.signal.aborted) return;
        setCandidates((previous) => (after ? [...previous, ...page.items] : page.items));
        setSelected((previous) =>
          previous.map((service) =>
            service.status === 'invalid'
              ? service
              : (page.items.find((candidate) => refKey(candidate) === refKey(service)) ?? service),
          ),
        );
        setCursor(page.next_cursor);
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
    },
    [toast],
  );
  useEffect(() => {
    void load();
    return () => abort.current?.abort();
  }, [load]);

  function toggleService(service: SubscriptionService) {
    const key = refKey(service);
    const existing = selected.find((value) => refKey(value) === key);
    const wasInvalid = item?.services.some(
      (value) => refKey(value) === key && value.status === 'invalid',
    );
    if (existing?.status === 'invalid' && service.status === 'available') {
      setSelected((old) => old.map((value) => (refKey(value) === key ? service : value)));
      setReselected((old) => [...old.filter((value) => refKey(value) !== key), service]);
    } else if (existing) {
      setSelected((old) => old.filter((value) => refKey(value) !== key));
      setReselected((old) => old.filter((value) => refKey(value) !== key));
    } else {
      setSelected((old) => [...old, service]);
      if (wasInvalid)
        setReselected((old) => [...old.filter((value) => refKey(value) !== key), service]);
    }
  }
  function move(index: number, offset: number) {
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        {...dialogFocus}
        title={item ? '编辑订阅' : '添加订阅'}
        className="sm:min-w-[min(720px,calc(100vw-32px))]"
        footer={
          <Button type="submit" form={form} loading={busy} disabled={!loaded}>
            保存订阅
          </Button>
        }
      >
        <form
          id={form}
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="订阅名称"
              value={name}
              maxLength={128}
              required
              onChange={(event) => setName(event.target.value)}
            />
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
          <section aria-labelledby={`${form}-rules`} className="space-y-3">
            <h2 id={`${form}-rules`} className="text-sm font-medium">
              应用规则
            </h2>
            <div className="flex flex-wrap gap-2">
              {rules.map((rule) => {
                const checked = ruleIDs.includes(rule.id);
                return (
                  <Button
                    key={rule.id}
                    type="button"
                    size="sm"
                    variant={checked ? 'primary' : 'secondary'}
                    aria-pressed={checked}
                    disabled={!rule.enabled && !checked}
                    onClick={() =>
                      setRuleIDs((old) =>
                        checked ? old.filter((id) => id !== rule.id) : [...old, rule.id],
                      )
                    }
                  >
                    {rule.name}
                    {!rule.enabled ? '（已停用）' : ''}
                  </Button>
                );
              })}
            </div>
            {rules.length === 0 && (
              <p className="text-sm text-[var(--text-secondary)]">
                暂无应用规则，请联系管理员添加。
              </p>
            )}
          </section>
          <section aria-labelledby={`${form}-selected`} className="space-y-3">
            <h2 id={`${form}-selected`} className="text-sm font-medium">
              已选服务
            </h2>
            {selected.length === 0 && (
              <p className="text-sm text-[var(--text-secondary)]">尚未选择服务。</p>
            )}
            <ul className="divide-y divide-[var(--border)]">
              {selected.map((service, index) => (
                <li
                  key={refKey(service)}
                  className="flex flex-wrap items-center justify-between gap-2 py-3"
                >
                  <span className="min-w-0 break-all text-sm">
                    {label(service)}
                    {service.status !== 'available'
                      ? `（${unavailableReasons[service.reason] ?? '服务不可用'}）`
                      : ''}
                    {service.incompatible_formats.length > 0
                      ? `（${service.incompatible_formats.join('、')} 不兼容 Xray REALITY）`
                      : ''}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={index === 0}
                      aria-label={`上移 ${label(service)}`}
                      onClick={() => move(index, -1)}
                    >
                      上移
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={index === selected.length - 1}
                      aria-label={`下移 ${label(service)}`}
                      onClick={() => move(index, 1)}
                    >
                      下移
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => toggleService(service)}
                    >
                      移除
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby={`${form}-available`} className="space-y-3" aria-busy={loading}>
            <h2 id={`${form}-available`} className="text-sm font-medium">
              可选服务
            </h2>
            {!loaded && loading ? <Skeleton label="正在读取可选服务" lines={3} /> : null}
            {loaded && candidates.length === 0 && (
              <p className="text-sm text-[var(--text-secondary)]">
                没有可选服务。请先发布服务并配置公网入口。
              </p>
            )}
            <ul className="divide-y divide-[var(--border)]">
              {candidates.map((service) => {
                const selectedService = selected.find((v) => refKey(v) === refKey(service));
                const needsReselection = selectedService?.status === 'invalid';
                const checked = Boolean(selectedService && !needsReselection);
                return (
                  <li
                    key={refKey(service)}
                    className="flex flex-wrap items-center justify-between gap-2 py-3"
                  >
                    <span className="min-w-0 break-all text-sm">
                      {label(service)}
                      <span className="ml-2 text-[var(--text-secondary)]">{service.engine}</span>
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      aria-pressed={checked}
                      onClick={() => toggleService(service)}
                    >
                      {needsReselection ? '重新选择' : checked ? '移除' : '添加'}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {cursor && (
              <Button
                type="button"
                variant="secondary"
                disabled={loading}
                onClick={() => void load(cursor)}
              >
                加载更多服务
              </Button>
            )}
            {!loaded && !loading && (
              <Button type="button" variant="secondary" onClick={() => void load()}>
                重新读取服务
              </Button>
            )}
          </section>
        </form>
      </DialogContent>
    </Dialog>
  );
}
