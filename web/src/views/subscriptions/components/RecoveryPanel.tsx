import { ArrowLeft, Check, Eye, Globe, RefreshCw, ScanSearch } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Session } from '@/api/auth';
import { engineSyncError } from '@/api/engines';
import {
  adoptSubscriptionRecovery,
  checkSubscriptionRecovery,
  confirmSubscriptionEndpoint,
  getSubscriptionRecovery,
  listSubscriptionRecoveries,
  type RecoveryService,
  type RecoveryStatus,
} from '@/api/subscriptions';
import { Button } from '@/components/arc/button/button';
import { Dialog, DialogContent } from '@/components/arc/dialog/dialog';
import { Input } from '@/components/arc/input/input';
import { useToastStack } from '@/components/arc/toast-stack/toast-stack';
import DataTable from '@/components/data-table';
import { useServerEvent } from '@/hooks/realtime';
import RecoveryChanges from './RecoveryChanges';
import { useDialogFocus } from './useDialogFocus';

const activeStates = new Set(['queued', 'dispatched', 'accepted', 'running']);
const changeLabels: Record<string, string> = {
  added: '节点新增',
  changed: '配置有变化',
  removed: '节点已移除',
  unchanged: '一致',
};

function statusLabel(item: RecoveryStatus) {
  if (item.state === 'mismatch') return '配置不一致';
  if (item.state === 'matched')
    return item.runtime_status === 'not_installed' ? '节点未安装' : '已核对';
  if (activeStates.has(item.task_state)) return '核对中';
  if (item.task_state === 'failed' || item.task_state === 'cancelled') return '核对失败';
  return '待核对';
}

function EndpointDialog({
  engine,
  service,
  session,
  onClose,
  onSaved,
}: {
  engine: RecoveryStatus;
  service: RecoveryService;
  session: Session;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useId();
  const { toast } = useToastStack();
  const dialogFocus = useDialogFocus();
  const [host, setHost] = useState(service.public_host);
  const [port, setPort] = useState(service.public_port ? String(service.public_port) : '');
  const [busy, setBusy] = useState(false);
  async function confirm() {
    if (busy) return;
    const number = Number(port);
    if (!host.trim() || !Number.isInteger(number) || number < 1 || number > 65535) {
      toast({
        id: 'subscription-endpoint-invalid',
        type: 'error',
        title: '请检查公网入口',
        description: '填写地址和 1 至 65535 的端口。',
      });
      return;
    }
    setBusy(true);
    try {
      await confirmSubscriptionEndpoint(engine, service, host.trim(), number, session);
      toast({ type: 'success', title: '公网入口已确认' });
      onSaved();
    } catch (error) {
      toast({
        id: `subscription-endpoint-${engine.engine_id}`,
        type: 'error',
        title: '未能确认公网入口',
        description: error instanceof Error ? error.message : '请刷新后重试。',
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
        data-subscription-management
        {...dialogFocus}
        title={`确认 ${service.name} 的公网入口`}
        description="确认地址和端口不会验证公网连通性。"
        footer={
          <Button type="submit" form={form} loading={busy}>
            <Check size={16} aria-hidden="true" />
            确认公网入口
          </Button>
        }
      >
        <form
          id={form}
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <Input
            label="公网地址"
            value={host}
            maxLength={253}
            required
            onChange={(event) => setHost(event.target.value)}
          />
          <Input
            label="公网端口"
            type="number"
            min={1}
            max={65535}
            required
            value={port}
            onChange={(event) => setPort(event.target.value)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function RecoveryPanel({
  session,
  onChanged,
}: {
  session: Session;
  onChanged: () => void;
}) {
  const { toast } = useToastStack();
  const confirmationFocus = useDialogFocus();
  const [items, setItems] = useState<RecoveryStatus[] | null>(null);
  const [cursor, setCursor] = useState('');
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<RecoveryStatus | null>(null);
  const [endpoint, setEndpoint] = useState<RecoveryService | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const detailID = useRef('');
  const keys = useRef<Record<string, string>>({});
  const load = useCallback(
    async (after = '') => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setLoading(true);
      try {
        const response = await listSubscriptionRecoveries(after, controller.signal);
        if (controller.signal.aborted) return;
        setItems((old) => (after ? [...(old ?? []), ...response.items] : response.items));
        setCursor(response.next_cursor);
        const id = detailID.current;
        if (id) {
          const updated =
            response.items.find((item) => item.engine_id === id) ??
            (await getSubscriptionRecovery(id, controller.signal));
          if (!controller.signal.aborted && detailID.current === id) setDetail(updated);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          toast({
            id: 'subscription-recovery-load',
            type: 'error',
            title: '未能读取恢复核对状态',
            description: error instanceof Error ? error.message : '请刷新后重试。',
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
  useServerEvent(
    (event) => {
      if (
        event.type === 'ready' ||
        (event.type === 'change' &&
          event.change.kind === 'tasks' &&
          items?.some((item) => item.task_id && item.task_id === event.change.task_id))
      )
        void load();
    },
    [{ kind: 'tasks', all: true }],
  );
  async function check(item: RecoveryStatus) {
    if (busy) return;
    setBusy(true);
    keys.current[item.engine_id] ??= crypto.randomUUID();
    try {
      await checkSubscriptionRecovery(item, keys.current[item.engine_id], session);
      delete keys.current[item.engine_id];
      toast({ type: 'info', title: '已提交只读核对任务' });
      await load();
    } catch (error) {
      toast({
        id: `subscription-recovery-check-${item.engine_id}`,
        type: 'error',
        title: '未能提交核对任务',
        description:
          error instanceof Error ? error.message : '请确认节点在线并支持当前 Agent 协议。',
      });
    } finally {
      setBusy(false);
    }
  }
  async function adopt() {
    if (!detail || busy) return;
    setBusy(true);
    try {
      await adoptSubscriptionRecovery(detail, session);
      setAdopting(false);
      toast({ type: 'success', title: '已采用节点当前配置' });
      await load();
      onChanged();
    } catch (error) {
      toast({
        id: `subscription-recovery-adopt-${detail.engine_id}`,
        type: 'error',
        title: '未能采用节点配置',
        description: error instanceof Error ? error.message : '请重新核对并检查节点权限。',
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      {!detail && (
        <>
          <div className="flex justify-end">
            <Button
              loading={loading}
              variant="secondary"
              disabled={loading}
              onClick={() => void load()}
            >
              <RefreshCw size={16} aria-hidden="true" />
              刷新核对状态
            </Button>
          </div>
          <DataTable
            caption="恢复核对"
            loaded={items !== null}
            loading={loading}
            emptyMessage="没有需要核对的引擎"
            rows={(items ?? []).map((item) => ({ ...item }))}
            rowKey="engine_id"
            columns={[
              { key: 'node_name', label: '节点' },
              { key: 'engine_name', label: '引擎' },
              {
                key: 'state',
                label: '状态',
                render: (_, item) => (
                  <span role="status">
                    {statusLabel(item)}
                    {item.task_state === 'failed' && item.error_code
                      ? `：${engineSyncError(item.error_code)}`
                      : ''}
                  </span>
                ),
              },
              {
                key: 'actions',
                label: '操作',
                sortable: false,
                render: (_, item) => (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={
                        busy || item.node_state !== 'online' || activeStates.has(item.task_state)
                      }
                      onClick={() => void check(item)}
                    >
                      <ScanSearch size={16} aria-hidden="true" />
                      核对
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        detailID.current = item.engine_id;
                        setDetail(item);
                      }}
                    >
                      <Eye size={16} aria-hidden="true" />
                      详情
                    </Button>
                  </div>
                ),
              },
            ]}
          />
          {cursor && (
            <Button variant="secondary" disabled={loading} onClick={() => void load(cursor)}>
              加载更多引擎
            </Button>
          )}
        </>
      )}
      {detail && (
        <section className="space-y-6" aria-label="恢复核对详情">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                aria-label="返回恢复核对列表"
                disabled={busy}
                onClick={() => {
                  detailID.current = '';
                  setDetail(null);
                }}
              >
                <ArrowLeft size={18} />
              </Button>
              <div>
                <h2 className="text-lg font-medium">
                  {detail.node_name} / {detail.engine_name}
                </h2>
                <p className="text-sm text-[var(--text-secondary)]" role="status">
                  {statusLabel(detail)}
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              disabled={
                busy || detail.node_state !== 'online' || activeStates.has(detail.task_state)
              }
              onClick={() => void check(detail)}
            >
              <ScanSearch size={16} aria-hidden="true" />
              重新核对
            </Button>
          </div>
          <section className="space-y-4 border-t border-[var(--border)] pt-5">
            <h3 className="text-base font-medium">1. 核对节点配置</h3>
            {detail.state === 'mismatch' && (
              <p className="text-sm text-[var(--text-secondary)]">
                备份与节点当前托管配置不一致，请查看差异后采用节点配置。
              </p>
            )}
            {detail?.state === 'mismatch' && <RecoveryChanges changes={detail.changes} />}
            {detail.state === 'mismatch' && (
              <Button disabled={busy} onClick={() => setAdopting(true)}>
                <Check size={16} aria-hidden="true" />
                采用节点当前配置
              </Button>
            )}
            {detail.state === 'matched' && (
              <p className="text-sm text-[var(--text-secondary)]">
                节点配置已核对。{detail.draft_needs_review ? '备份草稿仍需重新核对后发布。' : ''}
              </p>
            )}
          </section>
          <section className="space-y-3 border-t border-[var(--border)] pt-5">
            <h3 className="text-base font-medium">2. 确认公网入口</h3>
            {detail.state !== 'matched' && (
              <p className="text-sm text-[var(--text-secondary)]">完成配置核对后可确认服务入口。</p>
            )}
            {!detail.services.length && (
              <p className="text-sm text-[var(--text-secondary)]">没有待确认的服务。</p>
            )}
            <ul className="divide-y divide-[var(--border)]">
              {detail?.services.map((service) => (
                <li
                  key={service.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0 break-all text-sm">
                    <span>{service.name}</span>
                    <span className="ml-2 text-[var(--text-secondary)]">
                      {changeLabels[service.change] ?? service.change}
                      {service.credentials_changed ? '，凭证已变化' : ''}
                    </span>
                    <p className="text-[var(--text-secondary)]">
                      {service.public_host
                        ? `${service.public_host}:${service.public_port}`
                        : '未配置公网入口'}
                      {service.confirmed ? '，已确认' : ''}
                    </p>
                  </div>
                  {detail.state === 'matched' &&
                    service.enabled &&
                    service.change !== 'removed' && (
                      <Button size="sm" variant="secondary" onClick={() => setEndpoint(service)}>
                        <Globe size={16} aria-hidden="true" />
                        {service.confirmed ? '修改公网入口' : '确认公网入口'}
                      </Button>
                    )}
                </li>
              ))}
            </ul>
          </section>
          {detail?.state === 'pending' && (
            <p className="text-sm text-[var(--text-secondary)]">
              提交核对后，任务完成时会更新状态。
            </p>
          )}
          <Dialog open={adopting} onOpenChange={setAdopting}>
            <DialogContent
              data-subscription-management
              {...confirmationFocus}
              title="采用节点当前配置？"
              description="将更新面板中的引擎状态，保留备份草稿并要求重新核对。不会修改或重启节点。"
              footer={
                <Button loading={busy} onClick={() => void adopt()}>
                  <Check size={16} aria-hidden="true" />
                  确认采用配置
                </Button>
              }
            />
          </Dialog>
          {detail && endpoint && (
            <EndpointDialog
              engine={detail}
              service={endpoint}
              session={session}
              onClose={() => setEndpoint(null)}
              onSaved={() => {
                setEndpoint(null);
                void load();
                onChanged();
              }}
            />
          )}
        </section>
      )}
    </div>
  );
}
