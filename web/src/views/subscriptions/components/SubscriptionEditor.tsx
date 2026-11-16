import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
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
import { Checkbox } from '@/components/arc/checkbox/checkbox';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import SubscriptionServicePicker from './SubscriptionServicePicker';
import { useDialogFocus } from './useDialogFocus';

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
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const dialogFocus = useDialogFocus();
  const addRef = useRef<HTMLButtonElement>(null);

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

  function toggleService(service: SubscriptionService) {
    addRef.current?.focus();
    const key = refKey(service);
    setAnnouncement(`${label(service)}，已更新服务选择`);
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
  function addServices(services: SubscriptionService[]) {
    const added = new Map(services.map((service) => [refKey(service), service]));
    setSelected((old) => [
      ...old.map((service) => added.get(refKey(service)) ?? service),
      ...services.filter((service) => !old.some((value) => refKey(value) === refKey(service))),
    ]);
    setReselected((old) => [
      ...old.filter((service) => !added.has(refKey(service))),
      ...services.filter((service) =>
        item?.services.some(
          (value) => refKey(value) === refKey(service) && value.status === 'invalid',
        ),
      ),
    ]);
    setAnnouncement(`已添加 ${services.length} 个服务`);
    setPickerOpen(false);
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
        className="[--dialog-width:680px]"
        footer={
          <>
            <span
              className="mr-auto text-xs tabular-nums text-[var(--text-secondary)]"
              aria-live="polite"
            >
              已选 {ruleIDs.length} 项规则，{selected.length} 个服务
            </span>
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" form={form} loading={busy} disabled={!loaded}>
              保存订阅
            </Button>
          </>
        }
      >
        <form
          id={form}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset disabled={busy} className="min-w-0 space-y-6">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
              <Input
                label="订阅名称"
                placeholder="例如：日常使用"
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
              <div className="flex items-center justify-between gap-3">
                <h2 id={`${form}-rules`} className="text-sm font-medium">
                  应用规则
                </h2>
                <span className="text-xs text-[var(--text-secondary)]">可多选</span>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-3 [overflow-wrap:anywhere]">
                {rules.map((rule) => {
                  const checked = ruleIDs.includes(rule.id);
                  return (
                    <Checkbox
                      key={rule.id}
                      label={`${rule.name}${!rule.enabled ? '（已停用）' : ''}`}
                      checked={checked}
                      disabled={busy || (!rule.enabled && !checked)}
                      onCheckedChange={(next) =>
                        setRuleIDs((old) =>
                          next === true ? [...old, rule.id] : old.filter((id) => id !== rule.id),
                        )
                      }
                    />
                  );
                })}
              </div>
              {rules.length === 0 && (
                <p className="text-sm text-[var(--text-secondary)]">
                  暂无应用规则，请联系管理员添加。
                </p>
              )}
            </section>
            <section
              aria-labelledby={`${form}-selected`}
              className="space-y-3 border-t border-[var(--border-subtle)] pt-5"
            >
              <div className="flex items-center justify-between gap-3">
                <h2 id={`${form}-selected`} className="text-sm font-medium">
                  已选服务{' '}
                  <span className="ml-1 tabular-nums text-[var(--text-secondary)]">
                    {selected.length}
                  </span>
                </h2>
                <Button
                  ref={addRef}
                  type="button"
                  variant="secondary"
                  onClick={() => setPickerOpen(true)}
                >
                  <Plus size={16} aria-hidden="true" />
                  添加服务
                </Button>
              </div>
              <p className="sr-only" role="status">
                {announcement}
              </p>
              {selected.length === 0 && (
                <p className="py-4 text-center text-sm text-[var(--text-secondary)]">
                  尚未添加服务
                </p>
              )}
              <p className="text-xs text-[var(--text-secondary)]">按列表顺序导出</p>
              <ol className="divide-y divide-[var(--border-subtle)]">
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
                        className="w-5 shrink-0 text-xs tabular-nums text-[var(--text-secondary)]"
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1 basis-32">
                        <p className="break-all text-sm font-medium">
                          {service.service_name || service.service_id}
                        </p>
                        <p className="break-all text-xs text-[var(--text-secondary)]">
                          {service.node_name || service.node_id} / {service.engine}
                        </p>
                        {service.status !== 'available' && (
                          <p className="mt-1 text-xs text-[var(--danger)]">
                            {unavailableReasons[service.reason] ?? '服务不可用'}
                          </p>
                        )}
                        {service.incompatible_formats.length > 0 && (
                          <p className="mt-1 text-xs text-[var(--text-secondary)]">
                            {service.incompatible_formats.join('、')} 不兼容 Xray REALITY
                          </p>
                        )}
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        {replacement && (
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => toggleService(replacement)}
                          >
                            重新选择
                          </Button>
                        )}
                        {selected.length > 1 && (
                          <>
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={index === 0}
                              aria-label={`上移 ${label(service)}`}
                              title="上移"
                              onClick={() => move(index, -1)}
                            >
                              <ArrowUp size={16} aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              disabled={index === selected.length - 1}
                              aria-label={`下移 ${label(service)}`}
                              title="下移"
                              onClick={() => move(index, 1)}
                            >
                              <ArrowDown size={16} aria-hidden="true" />
                            </Button>
                          </>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={`移除 ${label(service)}`}
                          title="移除服务"
                          onClick={() => toggleService(service)}
                        >
                          <X size={16} aria-hidden="true" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          </fieldset>
        </form>
        {pickerOpen && (
          <SubscriptionServicePicker
            candidates={candidates}
            selected={selected}
            loaded={loaded}
            loading={loading}
            onRetry={() => void load()}
            onClose={() => setPickerOpen(false)}
            onAdd={addServices}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
